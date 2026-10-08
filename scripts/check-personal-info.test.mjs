// node --test scripts/check-personal-info.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  isAllowlistedDiffPath,
  maskSnippet,
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

test('flags personal email addresses', () => {
  assert.deepEqual(types('contact exampleuser@mail.test'), ['email']);
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
    body: 'write exampleuser@mail.test',
  }));
  assert.match(emailReport, /body: email/);
  assert.match(emailReport, /••••@••••/);
  assert.equal(emailReport.includes('exampleuser@mail.test'), false);

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
    pull_request: { number: 441, title: 'feat(window): topic row', body: pr441CleanBody },
  }));
  assert.deepEqual(readPullRequestEvent(eventPath), {
    number: 441,
    title: 'feat(window): topic row',
    body: pr441CleanBody,
  });
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
