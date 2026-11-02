// node --test scripts/check-personal-info.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  DIFF_PATH_ALLOWLIST,
  TRUSTED_CHECKOUT_REF,
  addedLinesFromPatch,
  collectFindings,
  findPersonalInfo,
  formatReport,
  gitAddedFiles,
  gitDiffPath,
  isAllowlistedDiffPath,
  loadPullRequestFiles,
  maskSnippet,
  parseGitDiffFiles,
  parseScanWorkflowPolicy,
  readPullRequestEvent,
  scanPullRequest,
} from './check-personal-info.mjs';

const types = (text) => findPersonalInfo(text).map((hit) => hit.type);

// Shapes from old PR descriptions, with fake names only. #441 and #312 cited a
// local spec file under a Windows user profile; #441's current body is the
// cleaned repo-relative form.
const pr441OldBody = [
  'The behavior and geometry follow',
  '`C:/Users/exampleuser/Code/Branch/docs/design/spec-v23/index.html`',
  '(thread row, lines 7943–8017 and 42358–42489), with per-thread pinning as the review decision.',
].join(' ');
const pr441CleanBody = [
  'The behavior and geometry follow `design/spec-v23/index.html`',
  '(thread row, lines 7943–8017 and 42358–42489), with per-thread pinning as the review decision.',
].join(' ');
const pr312OldBody = [
  'The layout follows `C:/Users/exampleuser/Code/Branch/docs/design/screens/set-advanced-light.png`;',
  'P60 changes the provider wording/behavior beyond that artifact.',
].join(' ');
const pr312CleanBody = [
  'The layout follows `docs/design/screens/set-advanced-light.png`;',
  'P60 changes the provider wording/behavior beyond that artifact.',
].join(' ');

test('flags Windows user-profile paths on any drive and slash style', () => {
  assert.deepEqual(types('See C:/Users/exampleuser/Code/Branch/docs/design/spec-v23/index.html'), [
    'windows-user-profile',
  ]);
  assert.deepEqual(types('See C:\\Users\\exampleuser\\Code\\Branch\\spec.html'), [
    'windows-user-profile',
  ]);
  assert.deepEqual(types('file:///D:/Users/exampleuser/spec.html'), [
    'windows-user-profile',
  ]);
  assert.deepEqual(types('E:/Users/exampleuser'), ['windows-user-profile']);
});

test('flags macOS /Users and Linux /home personal paths', () => {
  assert.deepEqual(types('open /Users/exampleuser/Code/Branch/docs/design/spec-v23/index.html'), [
    'macos-user-path',
  ]);
  assert.deepEqual(types('logs in /home/exampleuser/.branch'), ['linux-user-path']);
});

test('relative and module paths through home/ are not Linux home directories', () => {
  // The #1671 Android Home import, and the usual relative/module forms.
  assert.deepEqual(types("} from '../home/homeModel';"), []);
  assert.deepEqual(types("import HomeScreen from './home/HomeScreen'"), []);
  assert.deepEqual(types('from "../home/homeModel"'), []);
  assert.deepEqual(types("from '@/home/HomeScreen'"), []);
  assert.deepEqual(types("from '~/home/HomeScreen'"), []);
  assert.deepEqual(types('src/screens/home/HomeScreen'), []);
  assert.deepEqual(types('.../screens/home/HomeScreen'), []);
  assert.deepEqual(types('../Users/example/Code'), ['macos-user-path']);
  assert.deepEqual(types('./Users/example/Code'), ['macos-user-path']);
});

test('mixed-case names on a filesystem root are still personal paths', () => {
  assert.deepEqual(types('/Users/JaneDoe/Code'), ['macos-user-path']);
  assert.deepEqual(types('/home/JohnSmith/.branch'), ['linux-user-path']);
  assert.deepEqual(types('file:///Users/JaneDoe/spec.html'), ['macos-user-path']);
  assert.deepEqual(types('/var/../home/JohnSmith/x'), ['linux-user-path']);
  assert.deepEqual(types('/./home/JohnSmith/.branch'), ['linux-user-path']);
  assert.deepEqual(types('/../home/JohnSmith/.branch'), ['linux-user-path']);
  assert.deepEqual(types('/tmp/foo/../../home/JohnSmith/x'), ['linux-user-path']);
  assert.deepEqual(types('/./Users/JaneDoe/Code'), ['macos-user-path']);
  assert.deepEqual(types('/../Users/JaneDoe/Code'), ['macos-user-path']);
  assert.deepEqual(types('/var/../Users/JaneDoe/Code'), ['macos-user-path']);
  assert.deepEqual(types('file:///./home/JohnSmith/spec.html'), ['linux-user-path']);
  assert.deepEqual(types('file:///var/../home/JohnSmith/spec.html'), ['linux-user-path']);
  assert.deepEqual(types('open /Users/JaneDoe/Code and import ./home/HomeScreen'), ['macos-user-path']);
});

test('absolute user home directories still fail on each OS path style', () => {
  assert.deepEqual(types('/home/example/.branch'), ['linux-user-path']);
  assert.deepEqual(types('logs in /home/example/.branch'), ['linux-user-path']);
  assert.deepEqual(types('file:///home/example/spec.html'), ['linux-user-path']);
  assert.deepEqual(types('open /Users/example/Code/Branch'), ['macos-user-path']);
  assert.deepEqual(types('file:///Users/example/spec.html'), ['macos-user-path']);
  assert.deepEqual(types('See C:/Users/example/Code/Branch'), ['windows-user-profile']);
  assert.deepEqual(types('See C:\\Users\\example\\Code\\Branch'), ['windows-user-profile']);
  assert.deepEqual(types('file:///D:/Users/example/spec.html'), ['windows-user-profile']);
  assert.deepEqual(types('../../home/example/.branch'), ['linux-user-path']);
  assert.deepEqual(types('/./home/example/.branch'), ['linux-user-path']);
  assert.deepEqual(types('/../home/example/.branch'), ['linux-user-path']);
  assert.deepEqual(types('/var/../home/example/.branch'), ['linux-user-path']);
  assert.deepEqual(types('/tmp/foo/../../home/example/.ssh'), ['linux-user-path']);
  assert.deepEqual(types('file:///./home/example/spec.html'), ['linux-user-path']);
  assert.deepEqual(types('file:///var/../home/example/spec.html'), ['linux-user-path']);
  assert.deepEqual(types('/./Users/example/Code'), ['macos-user-path']);
  assert.deepEqual(types('/../Users/example/Code'), ['macos-user-path']);
  assert.deepEqual(types('/var/../Users/example/Code'), ['macos-user-path']);
});

test('a source diff with a relative home/ import is clean; an absolute home path is not', () => {
  const relative = [
    '@@ -1,0 +1,2 @@',
    "+} from '../home/homeModel';",
    "+import HomeScreen from './home/HomeScreen';",
  ].join('\n');
  assert.deepEqual(collectFindings({
    files: [{ filename: 'mobile/src/screens/HomeScreen.tsx', patch: relative }],
  }), []);

  const leaked = collectFindings({
    files: [{
      filename: 'docs/notes.md',
      patch: '@@ -1,0 +1,1 @@\n+logs in /home/example/.branch\n',
    }],
  });
  assert.equal(leaked.length, 1);
  assert.equal(leaked[0].source, 'diff');
  assert.equal(leaked[0].type, 'linux-user-path');
  assert.equal(leaked[0].snippet.includes('example'), false);
});

test('flags personal email addresses', () => {
  assert.deepEqual(types('contact exampleuser@gmail.com'), ['email']);
});

test('flags mDNS hostnames and Windows computer names', () => {
  assert.deepEqual(types('resolved exampleuser-office.local'), ['mdns-hostname']);
  assert.deepEqual(types('ran on DESKTOP-A1B2C3D'), ['windows-computer-name']);
  assert.deepEqual(types('ran on LAPTOP-ZX9Y8W7'), ['windows-computer-name']);
});

test('flags WORD_WORD Windows PC names next to machine/PC/computer', () => {
  assert.deepEqual(types('verified on the EXAMPLEUSER_OFFICE machine'), ['windows-pc-name']);
  assert.deepEqual(types('computer called EXAMPLEUSER_OFFICE'), ['windows-pc-name']);
  assert.deepEqual(types('PC: EXAMPLEUSER_DESKTOP'), ['windows-pc-name']);
  assert.deepEqual(types('host EXAMPLEUSER_PC'), ['windows-pc-name']);
});

test('old #441 and #312 description shapes are hits; cleaned bodies are allowed', () => {
  assert.deepEqual(types(pr441OldBody), ['windows-user-profile']);
  assert.deepEqual(types(pr312OldBody), ['windows-user-profile']);
  assert.deepEqual(types(pr441CleanBody), []);
  assert.deepEqual(types(pr312CleanBody), []);
});

test('allows placeholders, repo-relative paths, localhost and example.com', () => {
  assert.deepEqual(types('C:/Users/<name>/Code/Branch/docs/design/spec-v23/index.html'), []);
  assert.deepEqual(types('C:/Users/<user>/spec.html'), []);
  assert.deepEqual(types('%USERPROFILE%\\Code\\Branch\\docs\\design\\spec-v23\\index.html'), []);
  assert.deepEqual(types('~/Code/Branch/docs/design/spec-v23/index.html'), []);
  assert.deepEqual(types('/Users/<name>/Code/Branch/spec.html'), []);
  assert.deepEqual(types('/home/<user>/.branch'), []);
  assert.deepEqual(types('design/spec-v23/index.html'), []);
  assert.deepEqual(types('docs/design/screens/set-advanced-light.png'), []);
  assert.deepEqual(types('C:/Program Files/Google/Chrome/Application/chrome.exe'), []);
  assert.deepEqual(types('/usr/local/bin/branch'), []);
  assert.deepEqual(types('C:/Users/Public/Documents/spec.html'), []);
  assert.deepEqual(types('/Users/Shared/spec.html'), []);
  assert.deepEqual(types('/home/runner/work/Branch-Agent/Branch-Agent'), []);
  assert.deepEqual(types('user@example.com and docs@example.org'), []);
  assert.deepEqual(types('git@github.com:KeepOak/Branch-Agent.git'), []);
  assert.deepEqual(types('http://localhost:5174 and hostname.local plus <name>.local'), []);
  assert.deepEqual(types('DESKTOP-<id> and LAPTOP-<name>'), []);
  assert.deepEqual(types('EXAMPLE_PC is a placeholder next to a machine'), []);
});

test('keeps host/FEATURE_BATCH style false positives low', () => {
  assert.deepEqual(types('the host waits for FEATURE_BATCH checks'), []);
  assert.deepEqual(types('pull_request host and snake_case computer names'), []);
  assert.deepEqual(types('localStorage and localization stay unflagged'), []);
});

test('masked snippets hide the personal value and keep the pattern type', () => {
  const leaked = 'C:/Users/exampleuser/Code/Branch/docs/design/spec-v23/index.html';
  const report = formatReport(collectFindings({ title: leaked, body: '' }));
  assert.match(report, /title: windows-user-profile/);
  assert.match(report, /C:\/Users\/••••/);
  assert.equal(report.includes('exampleuser'), false);
  assert.equal(report.includes(leaked), false);

  const emailReport = formatReport(collectFindings({
    title: '',
    body: 'write exampleuser@gmail.com',
  }));
  assert.match(emailReport, /body: email/);
  assert.match(emailReport, /••••@••••/);
  assert.equal(emailReport.includes('exampleuser@gmail.com'), false);

  assert.equal(maskSnippet('mdns-hostname', 'exampleuser-office.local'), '••••.local');
  assert.equal(maskSnippet('windows-computer-name', 'DESKTOP-A1B2C3D'), 'DESKTOP-••••');
  assert.equal(maskSnippet('windows-pc-name', 'EXAMPLEUSER_OFFICE'), '••••_••••');
  assert.equal(maskSnippet('macos-user-path', '/Users/exampleuser').includes('exampleuser'), false);
});

test('scans only added diff lines and skips the documented fixture allowlist', () => {
  const patch = [
    '@@ -1,3 +1,4 @@',
    ' keep',
    '-C:/Users/exampleuser/old-spec.html',
    '+docs/design/spec-v23/index.html',
    '+C:/Users/exampleuser/Code/Branch/docs/design/spec-v23/index.html',
  ].join('\n');
  assert.deepEqual(addedLinesFromPatch(patch).map((row) => row.line), [2, 3]);

  const sourceHit = collectFindings({
    files: [{ filename: 'window/src/shell/TopicRail.tsx', patch }],
  });
  assert.equal(sourceHit.length, 1);
  assert.equal(sourceHit[0].source, 'diff');
  assert.equal(sourceHit[0].file, 'window/src/shell/TopicRail.tsx');
  assert.equal(sourceHit[0].line, 3);
  assert.equal(sourceHit[0].type, 'windows-user-profile');
  assert.equal(sourceHit[0].snippet.includes('exampleuser'), false);

  assert.equal(isAllowlistedDiffPath('scripts/check-personal-info.test.mjs'), true);
  assert.equal(isAllowlistedDiffPath('engine/src/lib/browser-redact.test.ts'), true);
  assert.equal(isAllowlistedDiffPath('engine/src/test-helpers/paths.ts'), true);
  assert.equal(isAllowlistedDiffPath('window/src/shell/TopicRail.tsx'), false);
  assert.deepEqual(collectFindings({
    files: [{ filename: 'scripts/check-personal-info.test.mjs', patch }],
  }), []);
  assert.ok(DIFF_PATH_ALLOWLIST.includes('scripts/check-personal-info.test.mjs'));
});

test('scanPullRequest reports title, body and diff separately', () => {
  const result = scanPullRequest({
    title: pr441OldBody,
    body: pr312OldBody,
    files: [{
      filename: 'README.md',
      patch: '@@ -1,0 +1,1 @@\n+verified on exampleuser-office.local\n',
    }],
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.findings.map((item) => [item.source, item.type]), [
    ['title', 'windows-user-profile'],
    ['body', 'windows-user-profile'],
    ['diff', 'mdns-hostname'],
  ]);
  assert.match(result.report, /diff README\.md:\+1: mdns-hostname/);
  assert.equal(result.report.includes('exampleuser'), false);

  const clean = scanPullRequest({
    title: 'feat(window): match preview topic row',
    body: pr441CleanBody,
    files: [{
      filename: 'README.md',
      patch: '@@ -1,0 +1,1 @@\n+See design/spec-v23/index.html\n',
    }],
  });
  assert.equal(clean.ok, true);
});

test('reads title and body from the event payload file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'personal-info-event-'));
  const eventPath = path.join(dir, 'event.json');
  writeFileSync(eventPath, JSON.stringify({
    pull_request: {
      number: 441,
      title: 'feat(window): topic row',
      body: pr441CleanBody,
      head: { sha: 'a'.repeat(40) },
    },
  }));
  assert.deepEqual(readPullRequestEvent(eventPath), {
    number: 441,
    headSha: 'a'.repeat(40),
    title: 'feat(window): topic row',
    body: pr441CleanBody,
  });
});

test('a `+++` added line is scanned, not skipped as a diff header', () => {
  const patch = '@@ -0,0 +1,2 @@\n+++ C:/Users/exampleuser/spec.html\n+ok';
  assert.deepEqual(addedLinesFromPatch(patch), [
    { line: 1, text: '++ C:/Users/exampleuser/spec.html' },
    { line: 2, text: 'ok' },
  ]);
  assert.deepEqual(collectFindings({ files: [{ filename: 'docs/notes.md', patch }] })
    .map((finding) => finding.type), ['windows-user-profile']);
});

test('gitDiffPath unquotes git names, drops a trailing tab, and ignores /dev/null', () => {
  assert.equal(gitDiffPath('b/spaced name.md\t'), 'spaced name.md');
  assert.equal(gitDiffPath('"b/say \\"hi\\".md"'), 'say "hi".md');
  assert.equal(gitDiffPath('/dev/null'), null);
});

test('parseGitDiffFiles keeps added hunks and drops renames, deletes and binaries', () => {
  const diff = [
    'diff --git a/notes.md b/notes.md',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/notes.md',
    '@@ -0,0 +1,2 @@',
    '+line',
    '+C:/Users/exampleuser/x',
    'diff --git a/spaced name.md b/spaced name.md',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/spaced name.md\t',
    '@@ -0,0 +1 @@',
    '+ok',
    'diff --git a/old.md b/old.md',
    'deleted file mode 100644',
    '--- a/old.md',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-gone',
    'diff --git a/README.md b/GUIDE.md',
    'similarity index 100%',
    'rename from README.md',
    'rename to GUIDE.md',
    'diff --git a/logo.png b/logo.png',
    'Binary files a/logo.png and b/logo.png differ',
  ].join('\n');
  const files = parseGitDiffFiles(diff);
  assert.deepEqual(files.map((file) => file.filename), ['notes.md', 'spaced name.md']);
  assert.equal(files[0].patch, '@@ -0,0 +1,2 @@\n+line\n+C:/Users/exampleuser/x');
  assert.deepEqual(parseGitDiffFiles(''), []);
});

// Git helpers for a hermetic fixture: origin has base on main, a PR head branch,
// and refs/pull/7/merge = merge(base, head), the same shape GitHub serves.
function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
    encoding: 'utf8',
  }).trim();
}

function makePullRequestOrigin(origin) {
  mkdirSync(origin);
  git(origin, ['init', '--quiet', '-b', 'main']);
  writeFileSync(path.join(origin, 'README.md'), 'base\n');
  writeFileSync(path.join(origin, 'gone.md'), 'bye\n');
  git(origin, ['add', '.']);
  git(origin, ['commit', '--quiet', '-m', 'base']);
  const base = git(origin, ['rev-parse', 'HEAD']);
  git(origin, ['checkout', '--quiet', '-b', 'feature']);
  writeFileSync(path.join(origin, 'notes.md'), 'line\nC:/Users/exampleuser/x\n+++ C:/Users/exampleuser/y\n');
  writeFileSync(path.join(origin, 'spaced name.md'), 'ok\n');
  git(origin, ['mv', 'README.md', 'GUIDE.md']);
  git(origin, ['rm', '--quiet', 'gone.md']);
  git(origin, ['add', '.']);
  git(origin, ['commit', '--quiet', '-m', 'head']);
  const head = git(origin, ['rev-parse', 'HEAD']);
  const merge = git(origin, ['commit-tree', `${head}^{tree}`, '-p', base, '-p', head, '-m', 'merge']);
  git(origin, ['update-ref', 'refs/pull/7/merge', merge]);
  git(origin, ['checkout', '--quiet', 'main']);
  return { base, head };
}

// Runs fn with a shallow clone of the default branch, as the workflow checks out.
function withShallowPrClone(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'personal-info-git-'));
  try {
    const { base, head } = makePullRequestOrigin(path.join(dir, 'origin'));
    const clone = path.join(dir, 'clone');
    execFileSync('git', ['clone', '--quiet', '--depth', '1', `file://${path.join(dir, 'origin')}`, clone], {
      encoding: 'utf8',
    });
    fn({ clone, base, head });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('gitAddedFiles reads the PR merge ref in a shallow clone without checking it out', () => {
  withShallowPrClone(({ clone, head }) => {
    const files = gitAddedFiles({ cwd: clone, prNumber: 7, headSha: head, sleep: () => {} });
    assert.deepEqual(files.map((file) => file.filename).sort(), ['notes.md', 'spaced name.md']);
    const notes = files.find((file) => file.filename === 'notes.md');
    assert.deepEqual(addedLinesFromPatch(notes.patch).map((row) => row.text), [
      'line',
      'C:/Users/exampleuser/x',
      '+++ C:/Users/exampleuser/y',
    ]);
    const findings = collectFindings({ files });
    assert.deepEqual(findings.map((item) => item.type), [
      'windows-user-profile',
      'windows-user-profile',
    ]);
    assert.equal(git(clone, ['status', '--porcelain']), '');
  });
});

test('gitAddedFiles refuses a merge ref whose second parent is not the event head', () => {
  withShallowPrClone(({ clone, base }) => {
    assert.throws(
      () => gitAddedFiles({ cwd: clone, prNumber: 7, headSha: base, sleep: () => {} }),
      /does not match the event head/,
    );
  });
});

test('gitAddedFiles reports a missing merge ref so the caller can fall back', () => {
  withShallowPrClone(({ clone, head }) => {
    assert.throws(
      () => gitAddedFiles({ cwd: clone, prNumber: 99, headSha: head, sleep: () => {} }),
      /not fetchable/,
    );
  });
});

test('loadPullRequestFiles uses git rows and never calls the API when the ref works', () => {
  const logs = [];
  const rows = [{ filename: 'a.md', patch: '@@ -0,0 +1 @@\n+ok' }];
  const files = loadPullRequestFiles({
    repo: 'KeepOak/Branch-Agent',
    token: 'unused',
    pullRequest: { number: 7, headSha: 'a'.repeat(40) },
    addedFiles: () => rows,
    fetchFiles: () => assert.fail('the REST files API must not run'),
    log: (line) => logs.push(line),
  });
  assert.deepEqual(files, rows);
  assert.match(logs.join('\n'), /read from git/);
});

test('loadPullRequestFiles falls back to the files API and logs the reason', () => {
  const logs = [];
  const apiRows = [{ filename: 'b.md', patch: '@@ -0,0 +1 @@\n+ok' }];
  const files = loadPullRequestFiles({
    repo: 'KeepOak/Branch-Agent',
    token: 'unused',
    pullRequest: { number: 8, headSha: 'a'.repeat(40) },
    addedFiles: () => {
      throw new Error('merge ref not fetchable');
    },
    fetchFiles: (repo, number) => {
      assert.equal(repo, 'KeepOak/Branch-Agent');
      assert.equal(number, 8);
      return apiRows;
    },
    log: (line) => logs.push(line),
  });
  assert.deepEqual(files, apiRows);
  assert.match(logs.join('\n'), /merge ref not fetchable/);
  assert.match(logs.join('\n'), /falling back to the GitHub files API/);
});

test('does not treat lowercase desktop- or laptop- names as Windows computer names', () => {
  assert.deepEqual(types('see .github/workflows/desktop-checks.yml'), []);
  assert.deepEqual(types('vitest.desktop-handoff.config.ts and desktop-update'), []);
  assert.deepEqual(types('Desktop-only window and desktop-version'), []);
  assert.deepEqual(types('laptop-bag next to desktop-controls'), []);
  assert.deepEqual(types('ran on DESKTOP-A1B2C3D'), ['windows-computer-name']);
  assert.deepEqual(types('ran on LAPTOP-ZX9Y8W7'), ['windows-computer-name']);
});

test('does not treat JS .local property access as an mDNS hostname', () => {
  assert.deepEqual(types('!m.models.some((x) => x.local)'), []);
  assert.deepEqual(types('const nearby = foo.local'), []);
  assert.deepEqual(types('if (model.local && m.local) return'), []);
  assert.deepEqual(types('cache.local('), []);
  assert.deepEqual(types('items.local[0]'), []);
  assert.deepEqual(types('resolved exampleuser-office.local'), ['mdns-hostname']);
  assert.deepEqual(types('Alices-MacBook-Pro.local'), ['mdns-hostname']);
});

test('skips retina @2x/@3x assets, WhatsApp JIDs, and reserved example domains', () => {
  assert.deepEqual(types('icon@2x.png and branch-16@3x.webp'), []);
  assert.deepEqual(types('15551234567@s.whatsapp.net'), []);
  assert.deepEqual(types('sample-group@g.us and sample-contact@c.us'), []);
  assert.deepEqual(types('docs@device.example and robot@mail.test'), []);
  assert.deepEqual(types('noreply@host.invalid'), []);
  assert.deepEqual(types('user@example.com and docs@example.org and ops@example.net'), []);
  assert.deepEqual(types('contact exampleuser@gmail.com'), ['email']);
});

test('treats you as a placeholder user', () => {
  assert.deepEqual(types('C:/Users/you/Code/branch-wt/foundation'), []);
  assert.deepEqual(types('C:\\Users\\you\\BranchApp'), []);
  assert.deepEqual(types('/Users/you/BranchApp'), []);
  assert.deepEqual(types('/home/you/.branch'), []);
  assert.deepEqual(types('C:/Users/exampleuser/Code/Branch/spec.html'), ['windows-user-profile']);
});

test('path usernames stop at markdown and punctuation so placeholders stay clean', () => {
  const forms = ['C:/Users/you', 'C:/Users/<name>', '/Users/you'];
  const wraps = [
    (value) => `\`${value}\``,
    (value) => `${value},`,
    (value) => `${value}.`,
    (value) => `${value})`,
    (value) => `${value}"`,
  ];
  for (const form of forms) {
    for (const wrap of wraps) {
      const sample = wrap(form);
      assert.deepEqual(types(sample), [], sample);
    }
  }
  assert.deepEqual(types('C:/Users/alice/Documents'), ['windows-user-profile']);
  assert.deepEqual(types('/Users/alice/Documents'), ['macos-user-path']);
  assert.deepEqual(types('`C:/Users/alice/Documents`'), ['windows-user-profile']);
  assert.deepEqual(types('See C:/Users/alice/Documents), please'), ['windows-user-profile']);
});

test('allows cursoragent and noreply addresses while personal mail still flags', () => {
  assert.deepEqual(types('cursoragent@cursor.com'), []);
  assert.deepEqual(types('noreply@github.com'), []);
  assert.deepEqual(types('no-reply@github.com'), []);
  assert.deepEqual(types('noreply@users.noreply.github.com'), []);
  assert.deepEqual(types('123+bot@users.noreply.github.com'), []);
  assert.deepEqual(types('alice@gmail.com'), ['email']);
});

test('scan workflow copies merge-gate-trusted concurrency so description edits do not cancel', () => {
  const yaml = readFileSync(new URL('../.github/workflows/personal-info-pr-scan.yml', import.meta.url), 'utf8');
  const trusted = readFileSync(new URL('../.github/workflows/merge-gate-trusted.yml', import.meta.url), 'utf8');
  const policy = parseScanWorkflowPolicy(yaml);
  const trustedPolicy = parseScanWorkflowPolicy(trusted);
  assert.equal(policy.concurrencyIncludesHeadSha, true);
  assert.equal(policy.cancelInProgressSkipsEdited, true);
  assert.equal(trustedPolicy.cancelInProgressSkipsEdited, true);
  assert.match(policy.concurrencyGroup, /github\.event\.pull_request\.head\.sha/);
  assert.equal(policy.cancelInProgress, "${{ github.event.action != 'edited' }}");
  assert.equal(trustedPolicy.cancelInProgress, policy.cancelInProgress);
});

test('trusted workflow checks out the default branch and does not echo the PR body', () => {
  const yaml = readFileSync(new URL('../.github/workflows/personal-info-pr-scan.yml', import.meta.url), 'utf8');
  const policy = parseScanWorkflowPolicy(yaml);
  assert.equal(policy.hasPullRequestTarget, true);
  assert.deepEqual(policy.targetTypes, ['opened', 'edited', 'synchronize', 'reopened']);
  assert.equal(policy.checkoutRef, TRUSTED_CHECKOUT_REF);
  assert.equal(policy.checksOutDefaultBranch, true);
  assert.equal(policy.checksOutPrHead, false);
  assert.equal(policy.persistCredentialsFalse, true);
  assert.equal(policy.interpolatesTitleOrBody, false);
  assert.match(yaml, /timeout-minutes:\s*5/);
  assert.doesNotMatch(yaml, /merge-gate(?:-trusted)?\.yml/);
});
