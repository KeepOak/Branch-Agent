// Gardener work filer: keeps the board full when no brief arrives.
//
// Reads three sources, newest signal first:
//   1. CI failure stats: workflows whose latest push or scheduled run on main failed.
//   2. Open audit findings: FAIL and HALF lines of the newest parity scorecard results file.
//   3. The roadmap: unchecked `- [ ] R-NNN` tasks in docs/roadmap/05-progress.md.
// Each candidate becomes a status:ready issue with area, prio and runs-on labels and a
// link to its source. Before filing it searches every open board issue (and issues closed
// in the last two weeks) for the same source, so it never duplicates a ready, claimed or
// in-review issue. It files at most --max-new issues per run and stops filing into an area
// once that area has --area-cap open status:ready issues.
//
// Dry run by default. Pass --apply to file issues.
//   node scripts/gardener/file-work.mjs --board KeepOak/Branch-Agent-Private --ci-repo KeepOak/Branch-Agent [--apply]

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULTS = Object.freeze({
  board: 'KeepOak/Branch-Agent-Private',
  ciRepo: 'KeepOak/Branch-Agent',
  ciBranch: 'main',
  runsPerWorkflow: 20,
  maxNew: 3,
  areaCap: 10,
  recentClosedDays: 14,
  progressPath: 'docs/roadmap/05-progress.md',
  parityDir: 'docs/roadmap/parity',
});

const SOURCE_MARKER = 'gardener-source:';
const CI_EVENTS = new Set(['push', 'schedule']);
const ROADMAP_PHASE_PRIO = { 1: 'p1', 2: 'p1', 3: 'p2', 4: 'p2', 5: 'p2', 6: 'p3' };

// Ordered: the first matching keyword picks the area. Roadmap lines name the surface they touch.
const AREA_KEYWORDS = [
  ['ci', /\b(ci|merge-gates?|gates?|workflows?|shards?|vitest|lint|typecheck)\b/i],
  ['updates', /\b(update|updates|updater|release)\b/i],
  ['settings', /\bsettings?\b/i],
  ['automations', /\b(automation|automations|routine|routines|cron)\b/i],
  ['library', /\b(library|memory|memories|skills?)\b/i],
  ['people', /\bpeople\b/i],
  ['grove', /\bgrove\b/i],
  ['canopy', /\bcanopy\b/i],
  ['computer', /\b(computer|browser|screen)\b/i],
  ['mobile', /\b(mobile|phone|ios|android)\b/i],
  ['desktop', /\b(desktop|electron|launcher)\b/i],
  ['setup', /\b(setup|onboarding|sign-in|login)\b/i],
  ['chat', /\b(chat|composer|message|messages|conversation|room)\b/i],
  ['shell', /\b(sidebar|menu|palette|header|toolbar)\b/i],
];

// Scorecard groups in docs/roadmap/parity/CHECKLIST.json. Unknown groups fall back to engine.
const PARITY_GROUP_AREA = {
  'Autonomy': 'engine',
  'Reliable runs': 'engine',
  'Rooms and messaging': 'chat',
  'Team and memory': 'library',
  'Model choice': 'settings',
  'Steering and queueing': 'engine',
  'Approvals': 'shell',
  'Self-checks': 'ci',
  'Mobile': 'mobile',
};

export function parseArgs(argv) {
  const options = { ...DEFAULTS, apply: false };
  const take = (index) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${argv[index]} needs a value`);
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--board') { options.board = take(index); index += 1; }
    else if (arg === '--ci-repo') { options.ciRepo = take(index); index += 1; }
    else if (arg === '--ci-branch') { options.ciBranch = take(index); index += 1; }
    else if (arg === '--max-new') { options.maxNew = positiveInt(arg, take(index)); index += 1; }
    else if (arg === '--area-cap') { options.areaCap = positiveInt(arg, take(index)); index += 1; }
    else if (arg === '--runs-per-workflow') { options.runsPerWorkflow = positiveInt(arg, take(index)); index += 1; }
    else throw new Error(`unknown option ${arg}`);
  }
  return options;
}

function positiveInt(name, value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error(`${name} needs a positive whole number`);
  return number;
}

export function makeGh({ execFile = execFileSync } = {}) {
  return function gh(args, { input } = {}) {
    const stdout = execFile('gh', args, {
      encoding: 'utf8',
      input,
      maxBuffer: 256 * 1024 * 1024,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return stdout ? JSON.parse(stdout) : null;
  };
}

export function listAll(gh, apiPath, { key, perPage = 100, maxPages = 20 } = {}) {
  const items = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const separator = apiPath.includes('?') ? '&' : '?';
    const response = gh(['api', `${apiPath}${separator}per_page=${perPage}&page=${page}`]);
    const batch = key ? response?.[key] ?? [] : response ?? [];
    items.push(...batch);
    if (batch.length < perPage) break;
  }
  return items;
}

export function readRepoFile(gh, repo, filePath) {
  const response = gh(['api', `repos/${repo}/contents/${encodeRepoPath(filePath)}`]);
  return Buffer.from(response.content ?? '', response.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
}

function encodeRepoPath(filePath) {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

function blobUrl(repo, filePath, line) {
  return `https://github.com/${repo}/blob/main/${filePath}${line ? `#L${line}` : ''}`;
}

// ---- Source 1: CI failure stats ----------------------------------------------------------

export function summarizeWorkflowRuns(runs) {
  const mainRuns = runs
    .filter((run) => CI_EVENTS.has(run.event) && run.status === 'completed'
      && run.conclusion !== 'cancelled' && run.conclusion !== 'skipped')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const failures = mainRuns.filter((run) => run.conclusion === 'failure');
  let streak = 0;
  for (const run of mainRuns) {
    if (run.conclusion !== 'failure') break;
    streak += 1;
  }
  return {
    total: mainRuns.length,
    failed: failures.length,
    streak,
    latest: mainRuns[0] ?? null,
    firstOfStreak: streak > 0 ? mainRuns[streak - 1] : null,
    oldest: mainRuns.at(-1) ?? null,
  };
}

export function ciCandidate({ ciRepo, ciBranch, workflow, stats, failedJobs }) {
  if (!stats.latest || stats.latest.conclusion !== 'failure') return null;
  const jobNames = [...new Set(failedJobs.map((job) => job.name))];
  const shownJobs = jobNames.slice(0, 2).join(', ') || 'a job';
  const more = jobNames.length > 2 ? ` and ${jobNames.length - 2} more` : '';
  const since = String(stats.oldest?.created_at ?? '').slice(0, 10);
  const lines = [
    `Source: failing CI job on \`${ciBranch}\`: [${workflow.name} run ${stats.latest.id}](${stats.latest.html_url}) (${workflow.path})`,
    '',
    `**Failure stats.** ${stats.failed} of the last ${stats.total} ${ciBranch} runs failed (push and scheduled runs since ${since}). The last ${stats.streak} in a row failed; the streak started with [run ${stats.firstOfStreak.id}](${stats.firstOfStreak.html_url}) on ${String(stats.firstOfStreak.created_at).slice(0, 10)}.`,
    '',
    '**Failing jobs in the latest run.**',
    ...(failedJobs.length
      ? failedJobs.slice(0, 10).map((job) => `- [${job.name}](${job.html_url})`)
      : ['- The run failed before any job reported (check the run page).']),
    '',
    `**Done when.** The cause is fixed (not retried away) and the next ${ciBranch} run of ${workflow.name} is green. Read the failing job log with \`gh api\` first, then write or update the matching ci-<failure-kind> skill.`,
  ];
  return {
    kind: 'ci',
    key: `ci:${ciRepo}:${workflow.path}`,
    matchers: [`ci:${ciRepo}:${workflow.path}`],
    title: `[ci] ${workflow.name} fails on ${ciBranch}: ${shownJobs}${more}`,
    area: 'ci',
    prio: stats.streak >= 2 || stats.failed * 2 >= stats.total ? 'p1' : 'p2',
    runsOn: 'any',
    sourceUrl: stats.latest.html_url,
    body: lines.join('\n'),
  };
}

export function collectCiCandidates(gh, { ciRepo, ciBranch, runsPerWorkflow }) {
  const workflows = listAll(gh, `repos/${ciRepo}/actions/workflows`, { key: 'workflows' })
    .filter((workflow) => workflow.state === 'active' && String(workflow.path).startsWith('.github/workflows/'));
  const candidates = [];
  for (const workflow of workflows) {
    const response = gh(['api', `repos/${ciRepo}/actions/workflows/${workflow.id}/runs?branch=${encodeURIComponent(ciBranch)}&status=completed&exclude_pull_requests=true&per_page=${runsPerWorkflow}`]);
    const stats = summarizeWorkflowRuns(response?.workflow_runs ?? []);
    if (!stats.latest || stats.latest.conclusion !== 'failure') continue;
    const jobs = listAll(gh, `repos/${ciRepo}/actions/runs/${stats.latest.id}/jobs`, { key: 'jobs', maxPages: 3 });
    const failedJobs = jobs.filter((job) => job.conclusion === 'failure');
    const candidate = ciCandidate({ ciRepo, ciBranch, workflow, stats, failedJobs });
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

// ---- Source 2: open audit findings (parity scorecard) ------------------------------------

export function newestResultsFile(entries) {
  return entries
    .map((entry) => entry.name)
    .filter((name) => /^results-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .at(-1) ?? null;
}

export function findingCandidates({ board, filePath, results }) {
  const date = results?.summary?.date ?? path.posix.basename(filePath).slice(8, 18);
  return (results?.lines ?? [])
    .filter((line) => line.verdict === 'FAIL' || line.verdict === 'HALF')
    .map((line) => {
      const area = PARITY_GROUP_AREA[line.group] ?? 'engine';
      const weight = Number(line.weight) || 1;
      const prio = line.verdict === 'FAIL' ? (weight >= 3 ? 'p0' : 'p1') : (weight >= 3 ? 'p1' : 'p2');
      const sourceUrl = blobUrl(board, filePath);
      return {
        kind: 'finding',
        key: `parity-line: ${line.id}`,
        matchers: [`parity-line: ${line.id}`, `[parity ${line.id}]`],
        title: `[parity ${line.id}] ${line.capability}`,
        area,
        prio,
        runsOn: 'any',
        sourceUrl,
        body: [
          `Source: open audit finding, parity scorecard line ${line.id} in [${filePath}](${sourceUrl}) (measured ${date}).`,
          '',
          `**Verdict at measure.** ${line.verdict} (weight ${weight}). Group: ${line.group}.`,
          `**Evidence.** ${line.evidence ?? 'none recorded'}`,
          '',
          `**Done when.** The scorecard runner reports line ${line.id} as PASS: \`python3 docs/roadmap/parity/run_scorecard.py docs/roadmap/parity/CHECKLIST.json <out> <raw>\`.`,
          '',
          `parity-line: ${line.id}`,
        ].join('\n'),
      };
    });
}

export function collectFindingCandidates(gh, { board, parityDir }) {
  const entries = gh(['api', `repos/${board}/contents/${encodeRepoPath(parityDir)}`]) ?? [];
  const name = newestResultsFile(entries);
  if (!name) return [];
  const filePath = `${parityDir}/${name}`;
  return findingCandidates({ board, filePath, results: JSON.parse(readRepoFile(gh, board, filePath)) });
}

// ---- Source 3: the roadmap ---------------------------------------------------------------

export function guessArea(text) {
  for (const [area, pattern] of AREA_KEYWORDS) {
    if (pattern.test(text)) return area;
  }
  return 'engine';
}

export function roadmapCandidates({ board, filePath, text }) {
  const candidates = [];
  let phase = null;
  const lines = String(text).split(/\r?\n/);
  lines.forEach((line, index) => {
    const heading = /^##\s+Phase\s+(\d+)/i.exec(line);
    if (heading) {
      phase = Number(heading[1]);
      return;
    }
    const task = /^- \[ \] (R-\d{3,})\s*[—-]\s*(.+)$/.exec(line);
    if (!task) return;
    const [, id, rest] = task;
    const summary = rest.trim();
    const shortTitle = summary.length > 90 ? `${summary.slice(0, 87).trimEnd()}...` : summary;
    const sourceUrl = blobUrl(board, filePath, index + 1);
    candidates.push({
      kind: 'roadmap',
      key: `roadmap:${id}`,
      matchers: [`roadmap:${id}`, `[roadmap ${id}]`],
      title: `[roadmap ${id}] ${shortTitle}`,
      area: guessArea(summary),
      prio: ROADMAP_PHASE_PRIO[phase] ?? 'p2',
      runsOn: 'any',
      sourceUrl,
      body: [
        `Source: roadmap task ${id}${phase ? ` (phase ${phase})` : ''}, [${filePath} line ${index + 1}](${sourceUrl}).`,
        '',
        `**Task.** ${summary}`,
        '',
        `**Done when.** The task's card in docs/roadmap/phases is met, and the line in ${filePath} is ticked with the PR, SHA and date. If GitHub shows the task is already finished or obsolete, tick or strike the line and close this issue with the evidence.`,
      ].join('\n'),
    });
  });
  return candidates;
}

export function collectRoadmapCandidates(gh, { board, progressPath }) {
  return roadmapCandidates({ board, filePath: progressPath, text: readRepoFile(gh, board, progressPath) });
}

// ---- Dedupe, caps and filing -------------------------------------------------------------

export function labelNames(issue) {
  return (issue.labels ?? []).map((label) => (typeof label === 'string' ? label : label.name));
}

function normalizeTitle(title) {
  return String(title).toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function findExisting(candidate, issues) {
  const wanted = normalizeTitle(candidate.title);
  const markers = [`${SOURCE_MARKER} ${candidate.key}`, ...candidate.matchers];
  return issues.find((issue) => {
    const haystack = `${issue.title}\n${issue.body ?? ''}`;
    if (markers.some((marker) => haystack.includes(marker))) return true;
    return wanted.length > 0 && normalizeTitle(issue.title) === wanted;
  }) ?? null;
}

export function readyCountsByArea(openIssues) {
  const counts = new Map();
  for (const issue of openIssues) {
    const labels = labelNames(issue);
    if (!labels.includes('status:ready')) continue;
    for (const label of labels) {
      if (label.startsWith('area:')) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return counts;
}

export function issueStatus(issue) {
  if (issue.state === 'closed') return 'closed';
  return labelNames(issue).find((label) => label.startsWith('status:'))?.slice('status:'.length) ?? 'open';
}

export function planFiling({ candidates, openIssues, recentIssues = [], labels, areaCap, maxNew }) {
  const openNumbers = new Set(openIssues.map((issue) => issue.number));
  const known = [...openIssues, ...recentIssues.filter((issue) => !openNumbers.has(issue.number))];
  const counts = readyCountsByArea(openIssues);
  const available = new Set(labels);
  const toFile = [];
  const skipped = [];
  const seenKeys = new Set();
  for (const candidate of candidates) {
    if (seenKeys.has(candidate.key)) continue;
    seenKeys.add(candidate.key);
    const existing = findExisting(candidate, known);
    if (existing) {
      skipped.push({ candidate, reason: `duplicate of #${existing.number} (${issueStatus(existing)})` });
      continue;
    }
    const issueLabels = ['status:ready', `area:${candidate.area}`, `prio:${candidate.prio}`, `runs-on:${candidate.runsOn}`];
    const missing = issueLabels.filter((label) => !available.has(label));
    if (missing.length) {
      skipped.push({ candidate, reason: `missing label ${missing.join(', ')}` });
      continue;
    }
    const areaLabel = `area:${candidate.area}`;
    const ready = counts.get(areaLabel) ?? 0;
    if (ready >= areaCap) {
      skipped.push({ candidate, reason: `${areaLabel} already has ${ready} open status:ready issues (cap ${areaCap})` });
      continue;
    }
    if (toFile.length >= maxNew) {
      skipped.push({ candidate, reason: `run limit of ${maxNew} new issues reached` });
      continue;
    }
    counts.set(areaLabel, ready + 1);
    toFile.push({ candidate, labels: issueLabels });
  }
  return { toFile, skipped };
}

// Duplicates are listed one by one so a reader can check the match; the other skip reasons are
// counted, because a full board can skip hundreds of roadmap lines on every run.
export function summarizeSkips(skipped) {
  const lines = [];
  const grouped = new Map();
  for (const { candidate, reason } of skipped) {
    if (reason.startsWith('duplicate of')) {
      lines.push(`skip ${candidate.key}: ${reason}`);
      continue;
    }
    const key = reason.replace(/ already has \d+ open status:ready issues \(cap (\d+)\)/, ' is at its cap of $1 open status:ready issues');
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  for (const [reason, count] of grouped) lines.push(`skip ${count} candidate(s): ${reason}`);
  return lines;
}

export function issuePayload({ candidate, labels }, { now }) {
  return {
    title: candidate.title,
    labels,
    body: [
      candidate.body,
      '',
      '---',
      `Filed by the Gardener work filer (scripts/gardener/file-work.mjs) on ${now.toISOString().slice(0, 10)}. Claim it like any status:ready issue.`,
      `${SOURCE_MARKER} ${candidate.key}`,
    ].join('\n'),
  };
}

export function run({ gh, options, now = new Date(), log = console.log }) {
  const openIssues = listAll(gh, `repos/${options.board}/issues?state=open`).filter((issue) => !issue.pull_request);
  const since = new Date(now.getTime() - options.recentClosedDays * 24 * 60 * 60 * 1000).toISOString();
  const recentIssues = listAll(gh, `repos/${options.board}/issues?state=closed&since=${since}`, { maxPages: 5 })
    .filter((issue) => !issue.pull_request);
  const labels = listAll(gh, `repos/${options.board}/labels`).map((label) => label.name);

  const candidates = [];
  const sources = [
    ['CI failure stats', () => collectCiCandidates(gh, options)],
    ['audit findings', () => collectFindingCandidates(gh, options)],
    ['roadmap', () => collectRoadmapCandidates(gh, options)],
  ];
  const sourceErrors = [];
  for (const [name, collect] of sources) {
    try {
      const found = collect();
      log(`${name}: ${found.length} candidate(s)`);
      candidates.push(...found);
    } catch (error) {
      sourceErrors.push(name);
      log(`${name}: could not read (${String(error.message).split('\n')[0]})`);
    }
  }
  if (sourceErrors.length === sources.length) throw new Error('no source could be read');

  const plan = planFiling({ candidates, openIssues, recentIssues, labels, areaCap: options.areaCap, maxNew: options.maxNew });
  for (const line of summarizeSkips(plan.skipped)) log(line);
  const filed = [];
  for (const item of plan.toFile) {
    const payload = issuePayload(item, { now });
    if (!options.apply) {
      log(`would file [${item.labels.join(', ')}] ${payload.title} (source ${item.candidate.sourceUrl})`);
      continue;
    }
    const created = gh(['api', `repos/${options.board}/issues`, '--method', 'POST', '--input', '-'], { input: JSON.stringify(payload) });
    filed.push(created);
    log(`filed #${created.number} ${created.html_url} (source ${item.candidate.sourceUrl})`);
  }
  return { filed, plan, sourceErrors };
}

function isMain() {
  return Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = run({ gh: makeGh(), options });
    const count = options.apply ? result.filed.length : result.plan.toFile.length;
    console.log(`${options.apply ? 'filed' : 'would file'} ${count} issue(s); skipped ${result.plan.skipped.length}`);
  } catch (error) {
    console.error(`gardener: ${error.message}`);
    process.exitCode = 1;
  }
}
