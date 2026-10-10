import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findExisting,
  findingCandidates,
  guessArea,
  makeGh,
  newestResultsFile,
  parseArgs,
  planFiling,
  roadmapCandidates,
  run,
  summarizeSkips,
  summarizeWorkflowRuns,
} from './file-work.mjs';

const BOARD = 'Org/Board';
const CI = 'Org/App';
const LABELS = [
  'status:ready', 'status:claimed', 'status:in-review',
  'area:ci', 'area:engine', 'area:chat', 'area:settings',
  'prio:p0', 'prio:p1', 'prio:p2', 'prio:p3',
  'runs-on:any',
].map((name) => ({ name }));

function runOf(id, conclusion, day, event = 'push') {
  return {
    id,
    event,
    status: 'completed',
    conclusion,
    created_at: `2026-10-${String(day).padStart(2, '0')}T08:00:00Z`,
    html_url: `https://github.com/${CI}/actions/runs/${id}`,
  };
}

function issue(number, title, labels, body = '', state = 'open') {
  return { number, title, body, state, labels: labels.map((name) => ({ name })) };
}

const PROGRESS = [
  '# Progress',
  '## Phase 1 — Fix what is broken',
  '- [x] R-002 — Birch: fix PR #611 Settings dead pins (PR #611, a4ac1d66, 2026-10-08)',
  '- [ ] R-007 — Cedar: #613 message box ignores Enter/Send',
  '## Phase 6 — New features',
  '- [ ] R-200 — Harvest voice notes into the engine',
].join('\n');

const RESULTS = {
  summary: { date: '2026-10-09' },
  lines: [
    { id: 'A01', group: 'Autonomy', capability: 'Picks its own next card', weight: 3, verdict: 'HALF', evidence: '54% self-picked' },
    { id: 'A04', group: 'Autonomy', capability: 'Gates block merges', weight: 2, verdict: 'PASS', evidence: 'ok' },
    { id: 'H01', group: 'Self-checks', capability: 'Every PR carries a SELF-CHECK block', weight: 3, verdict: 'FAIL', evidence: '3 of 20' },
  ],
};

function base64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

// A fake gh that answers the REST paths the filer reads, and records every issue it creates.
function fakeGh({ openIssues = [], closedIssues = [], workflowRuns = {}, jobs = {}, labels = LABELS, progress = PROGRESS, results = RESULTS } = {}) {
  const created = [];
  const calls = [];
  const gh = (args, { input } = {}) => {
    calls.push(args.join(' '));
    const [, apiPath] = args;
    if (args.includes('POST')) {
      const payload = JSON.parse(input);
      const number = 1000 + created.length;
      created.push(payload);
      return { number, html_url: `https://github.com/${BOARD}/issues/${number}`, ...payload };
    }
    const page = Number(/[?&]page=(\d+)/.exec(apiPath)?.[1] ?? 1);
    const pageOf = (items) => (page === 1 ? items : []);
    if (apiPath.startsWith(`repos/${BOARD}/issues?state=open`)) return pageOf(openIssues);
    if (apiPath.startsWith(`repos/${BOARD}/issues?state=closed`)) return pageOf(closedIssues);
    if (apiPath.startsWith(`repos/${BOARD}/labels`)) return pageOf(labels);
    if (apiPath.startsWith(`repos/${CI}/actions/workflows?`)) {
      return {
        workflows: pageOf(Object.keys(workflowRuns).map((file, index) => ({
          id: index + 1, name: file.replace('.yml', ''), path: `.github/workflows/${file}`, state: 'active',
        }))),
      };
    }
    const runsMatch = /^repos\/Org\/App\/actions\/workflows\/(\d+)\/runs/.exec(apiPath);
    if (runsMatch) return { workflow_runs: Object.values(workflowRuns)[Number(runsMatch[1]) - 1] };
    const jobsMatch = /^repos\/Org\/App\/actions\/runs\/(\d+)\/jobs/.exec(apiPath);
    if (jobsMatch) return { jobs: pageOf(jobs[jobsMatch[1]] ?? []) };
    if (apiPath === `repos/${BOARD}/contents/docs/roadmap/parity`) {
      return [{ name: 'results-2026-10-08.json' }, { name: 'results-2026-10-09.json' }, { name: 'CHECKLIST.json' }];
    }
    if (apiPath === `repos/${BOARD}/contents/docs/roadmap/parity/results-2026-10-09.json`) {
      return { encoding: 'base64', content: base64(JSON.stringify(results)) };
    }
    if (apiPath === `repos/${BOARD}/contents/docs/roadmap/05-progress.md`) {
      return { encoding: 'base64', content: base64(progress) };
    }
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  return { gh, created, calls };
}

const NOW = new Date('2026-10-10T09:00:00Z');
const quiet = () => {};

function options(extra = []) {
  return parseArgs(['--board', BOARD, '--ci-repo', CI, ...extra]);
}

test('a workflow failing on main is filed as a ready ci issue with its failure stats and run link', () => {
  const { gh, created } = fakeGh({
    workflowRuns: {
      'harvest.yml': [runOf(30, 'failure', 9, 'schedule'), runOf(20, 'failure', 8, 'schedule'), runOf(10, 'success', 7, 'schedule')],
      'lint.yml': [runOf(31, 'success', 9), runOf(21, 'failure', 8)],
    },
    jobs: { 30: [{ name: 'Harvest engine 35/44', conclusion: 'failure', html_url: 'https://github.com/Org/App/actions/runs/30/job/1' }, { name: 'select', conclusion: 'success' }] },
    progress: '# Progress',
    results: { lines: [] },
  });
  const result = run({ gh, options: options(['--apply']), now: NOW, log: quiet });
  assert.equal(created.length, 1);
  const [filed] = created;
  assert.equal(filed.title, '[ci] harvest fails on main: Harvest engine 35/44');
  assert.deepEqual(filed.labels, ['status:ready', 'area:ci', 'prio:p1', 'runs-on:any']);
  assert.match(filed.body, /Source: failing CI job on .main.: \[harvest run 30\]\(https:\/\/github\.com\/Org\/App\/actions\/runs\/30\)/);
  assert.match(filed.body, /2 of the last 3 main runs failed/);
  assert.match(filed.body, /streak started with \[run 20\]/);
  assert.match(filed.body, /- \[Harvest engine 35\/44\]\(https:\/\/github\.com\/Org\/App\/actions\/runs\/30\/job\/1\)/);
  assert.match(filed.body, /gardener-source: ci:Org\/App:\.github\/workflows\/harvest\.yml$/);
  assert.equal(result.filed[0].number, 1000);
});

test('an audit finding and a roadmap task are filed with their source linked', () => {
  const { gh, created } = fakeGh({ workflowRuns: {} });
  run({ gh, options: options(['--apply']), now: NOW, log: quiet });
  const titles = created.map((payload) => payload.title);
  assert.deepEqual(titles, [
    '[parity A01] Picks its own next card',
    '[parity H01] Every PR carries a SELF-CHECK block',
    '[roadmap R-007] Cedar: #613 message box ignores Enter/Send',
  ]);
  const [a01, h01, r007] = created;
  assert.deepEqual(a01.labels, ['status:ready', 'area:engine', 'prio:p1', 'runs-on:any']);
  assert.deepEqual(h01.labels, ['status:ready', 'area:ci', 'prio:p0', 'runs-on:any']);
  assert.match(a01.body, /\(https:\/\/github\.com\/Org\/Board\/blob\/main\/docs\/roadmap\/parity\/results-2026-10-09\.json\)/);
  assert.match(a01.body, /parity-line: A01/);
  assert.deepEqual(r007.labels, ['status:ready', 'area:chat', 'prio:p1', 'runs-on:any']);
  assert.match(r007.body, /\[docs\/roadmap\/05-progress\.md line 4\]\(https:\/\/github\.com\/Org\/Board\/blob\/main\/docs\/roadmap\/05-progress\.md#L4\)/);
});

test('never files a duplicate of a claimed, in-review or ready issue for the same source', () => {
  const { gh, created } = fakeGh({
    workflowRuns: { 'harvest.yml': [runOf(30, 'failure', 9)] },
    openIssues: [
      issue(7, 'Harvest is red', ['status:claimed', 'area:ci'], 'gardener-source: ci:Org/App:.github/workflows/harvest.yml'),
      issue(8, '[parity A01] Picks its own next card with no human dispatch', ['status:in-review', 'area:engine'], 'parity-line: A01'),
      issue(9, '[parity H01] Every PR carries a SELF-CHECK block', ['status:ready', 'area:ci']),
      issue(10, '[roadmap R-007] Cedar: message box', ['status:ready', 'area:chat'], 'roadmap:R-007'),
    ],
  });
  const lines = [];
  run({ gh, options: options(['--apply']), now: NOW, log: (line) => lines.push(line) });
  assert.deepEqual(created.map((payload) => payload.title), ['[roadmap R-200] Harvest voice notes into the engine']);
  assert.ok(lines.includes('skip ci:Org/App:.github/workflows/harvest.yml: duplicate of #7 (claimed)'));
  assert.ok(lines.includes('skip parity-line: A01: duplicate of #8 (in-review)'));
  assert.ok(lines.includes('skip parity-line: H01: duplicate of #9 (ready)'));
  assert.ok(lines.includes('skip roadmap:R-007: duplicate of #10 (ready)'));
});

test('an issue closed in the last two weeks for the same source is not filed again', () => {
  const { gh, created } = fakeGh({
    workflowRuns: {},
    progress: '# Progress',
    results: RESULTS,
    closedIssues: [issue(11, 'Self-check', [], 'parity-line: H01', 'closed'), issue(12, 'Picks', [], 'parity-line: A01', 'closed')],
  });
  run({ gh, options: options(['--apply']), now: NOW, log: quiet });
  assert.deepEqual(created, []);
});

test('stops filing into an area that has reached its cap of open ready issues', () => {
  const full = [1, 2].map((number) => issue(number, `chat thing ${number}`, ['status:ready', 'area:chat']));
  const claimedElsewhere = issue(3, 'engine claimed', ['status:claimed', 'area:engine']);
  const plan = planFiling({
    candidates: roadmapCandidates({ board: BOARD, filePath: 'p.md', text: '- [ ] R-007 — message box ignores Enter\n- [ ] R-300 — gateway restarts drop runs\n- [ ] R-301 — engine drops a run' }),
    openIssues: [...full, claimedElsewhere],
    labels: LABELS.map((label) => label.name),
    areaCap: 2,
    maxNew: 5,
  });
  assert.deepEqual(plan.toFile.map((item) => item.candidate.key), ['roadmap:R-300', 'roadmap:R-301']);
  assert.deepEqual(plan.skipped.map((item) => item.reason), ['area:chat already has 2 open status:ready issues (cap 2)']);

  const capped = planFiling({
    candidates: roadmapCandidates({ board: BOARD, filePath: 'p.md', text: '- [ ] R-300 — gateway restarts drop runs\n- [ ] R-301 — engine drops a run' }),
    openIssues: [],
    labels: LABELS.map((label) => label.name),
    areaCap: 1,
    maxNew: 5,
  });
  assert.deepEqual(capped.toFile.map((item) => item.candidate.key), ['roadmap:R-300']);
  assert.equal(capped.skipped[0].reason, 'area:engine already has 1 open status:ready issues (cap 1)');
});

test('files no more than --max-new issues per run and nothing without --apply', () => {
  const dry = fakeGh({ workflowRuns: {} });
  const lines = [];
  const result = run({ gh: dry.gh, options: options(['--max-new', '2']), now: NOW, log: (line) => lines.push(line) });
  assert.equal(dry.created.length, 0);
  assert.equal(result.plan.toFile.length, 2);
  assert.ok(lines.some((line) => line.startsWith('would file [status:ready, area:engine, prio:p1, runs-on:any] [parity A01]')));
  assert.ok(lines.includes('skip 2 candidate(s): run limit of 2 new issues reached'));
  assert.ok(dry.calls.every((call) => !call.includes('POST')));
});

test('skips a candidate whose labels do not exist on the board instead of inventing labels', () => {
  const plan = planFiling({
    candidates: roadmapCandidates({ board: BOARD, filePath: 'p.md', text: '- [ ] R-050 — Grove desks overlap' }),
    openIssues: [],
    labels: LABELS.map((label) => label.name),
    areaCap: 10,
    maxNew: 3,
  });
  assert.deepEqual(plan.toFile, []);
  assert.equal(plan.skipped[0].reason, 'missing label area:grove');
});

test('a source that cannot be read is reported and the others still file', () => {
  const { gh, created } = fakeGh({ workflowRuns: {}, results: RESULTS });
  const broken = (args, extra) => {
    if (args[1].includes('05-progress.md')) throw new Error('HTTP 404: Not Found\nmore');
    return gh(args, extra);
  };
  const lines = [];
  const result = run({ gh: broken, options: options(['--apply']), now: NOW, log: (line) => lines.push(line) });
  assert.deepEqual(result.sourceErrors, ['roadmap']);
  assert.ok(lines.includes('roadmap: could not read (HTTP 404: Not Found)'));
  assert.equal(created.length, 2);
});

test('fails the run when no source can be read', () => {
  const gh = (args) => {
    if (/issues|labels/.test(args[1])) return [];
    throw new Error('HTTP 403: rate limited');
  };
  assert.throws(() => run({ gh, options: options(), now: NOW, log: quiet }), /no source could be read/);
});

test('summarizeWorkflowRuns counts push and scheduled runs and ignores cancelled ones', () => {
  const stats = summarizeWorkflowRuns([
    runOf(1, 'success', 1),
    runOf(4, 'cancelled', 4),
    runOf(3, 'failure', 3),
    runOf(5, 'failure', 5, 'workflow_dispatch'),
    runOf(2, 'failure', 2, 'schedule'),
  ]);
  assert.equal(stats.total, 3);
  assert.equal(stats.failed, 2);
  assert.equal(stats.streak, 2);
  assert.equal(stats.latest.id, 3);
  assert.equal(stats.firstOfStreak.id, 2);
});

test('helpers: newest results file, area guess, title match, skip summary, args', () => {
  assert.equal(newestResultsFile([{ name: 'results-2026-10-01.json' }, { name: 'results-2026-10-09.json' }, { name: 'SCORE.md' }]), 'results-2026-10-09.json');
  assert.equal(newestResultsFile([{ name: 'CHECKLIST.json' }]), null);
  assert.equal(guessArea('Re-run timed-out merge-gates'), 'ci');
  assert.equal(guessArea('Settings search "backups"'), 'settings');
  assert.equal(guessArea('gateway self-link'), 'engine');
  assert.equal(findingCandidates({ board: BOARD, filePath: 'docs/roadmap/parity/results-2026-10-09.json', results: RESULTS }).length, 2);
  const candidate = roadmapCandidates({ board: BOARD, filePath: 'p.md', text: '- [ ] R-090 — Message box ignores Enter' })[0];
  assert.equal(findExisting(candidate, [issue(5, 'Message box ignores Enter', ['status:ready'])]).number, 5);
  assert.equal(findExisting(candidate, [issue(6, 'Message box ignores Escape', ['status:ready'])]), null);
  assert.deepEqual(summarizeSkips([
    { candidate: { key: 'a' }, reason: 'duplicate of #1 (ready)' },
    { candidate: { key: 'b' }, reason: 'area:chat already has 12 open status:ready issues (cap 10)' },
    { candidate: { key: 'c' }, reason: 'area:chat already has 12 open status:ready issues (cap 10)' },
  ]), ['skip a: duplicate of #1 (ready)', 'skip 2 candidate(s): area:chat is at its cap of 10 open status:ready issues']);
  assert.throws(() => parseArgs(['--max-new', '0']), /positive whole number/);
  assert.throws(() => parseArgs(['--board']), /needs a value/);
  assert.equal(parseArgs(['--area-cap', '4']).areaCap, 4);
});

test('makeGh runs gh hidden and parses its JSON output', () => {
  let seen;
  const gh = makeGh({ execFile: (file, args, opts) => { seen = { file, args, opts }; return '{"ok":true}'; } });
  assert.deepEqual(gh(['api', 'x'], { input: 'body' }), { ok: true });
  assert.equal(seen.file, 'gh');
  assert.equal(seen.opts.windowsHide, true);
  assert.equal(seen.opts.input, 'body');
});
