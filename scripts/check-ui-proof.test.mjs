import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkPrProof,
  checkUIProof,
  hasScreenshotProof,
  isAcceptedProofUrl,
  isWindowUISource,
  lookupProofSha,
  parseRawProofUrl,
  rejectedRawProofUrls,
} from './check-ui-proof.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const RAW_PROOF = `https://raw.githubusercontent.com/KeepOak/Branch-Agent/${SHA}/proof/changed-panel.png`;
const ATTACHMENT = 'https://github.com/user-attachments/assets/abcd-efgh';

test('isWindowUISource identifies window UI source files', () => {
  assert.equal(isWindowUISource('window/src/composer/Composer.tsx'), true);
  assert.equal(isWindowUISource('window/src/setup/SetupFlow.tsx'), true);
  assert.equal(isWindowUISource('window/src/main.tsx'), true);
  assert.equal(isWindowUISource('window/src/utils.ts'), true);
});

test('isWindowUISource excludes test files', () => {
  assert.equal(isWindowUISource('window/src/composer/Composer.test.tsx'), false);
  assert.equal(isWindowUISource('window/src/setup/setup.test.tsx'), false);
});

test('isWindowUISource excludes type declaration files', () => {
  assert.equal(isWindowUISource('window/src/types.d.ts'), false);
  assert.equal(isWindowUISource('window/src/global.d.ts'), false);
});

test('isWindowUISource excludes non-window files', () => {
  assert.equal(isWindowUISource('engine/src/agents/agent.ts'), false);
  assert.equal(isWindowUISource('desktop/scripts/config.mjs'), false);
  assert.equal(isWindowUISource('scripts/check-ui-proof.mjs'), false);
});

test('parseRawProofUrl accepts a SHA-pinned KeepOak proof path', () => {
  const parsed = parseRawProofUrl(RAW_PROOF);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.sha, SHA);
  assert.equal(parsed.file, 'changed-panel.png');
});

test('parseRawProofUrl rejects branch names, other repos, and docs/proof paths', () => {
  assert.equal(parseRawProofUrl('https://raw.githubusercontent.com/KeepOak/Branch-Agent/main/proof/changed-panel.png').ok, false);
  assert.equal(parseRawProofUrl('https://raw.githubusercontent.com/KeepOak/Branch-Agent/main/proof/changed-panel.png').reason, 'branch-ref');
  assert.equal(parseRawProofUrl(`https://raw.githubusercontent.com/KeepOak/Branch-Agent/${SHA}/docs/proof/changed-panel.png`).ok, false);
  assert.equal(parseRawProofUrl(`https://raw.githubusercontent.com/other/repo/${SHA}/proof/changed-panel.png`).ok, false);
  assert.equal(parseRawProofUrl(`https://raw.githubusercontent.com/KeepOak/Branch-Agent/${SHA.slice(0, 12)}/proof/changed-panel.png`).ok, false);
  assert.equal(parseRawProofUrl(`https://raw.githubusercontent.com/KeepOak/Branch-Agent/${SHA}/window/src/shot.png`).ok, false);
});

test('isAcceptedProofUrl accepts the two sanctioned forms only', () => {
  assert.equal(isAcceptedProofUrl(RAW_PROOF), true);
  assert.equal(isAcceptedProofUrl(ATTACHMENT), true);
  assert.equal(isAcceptedProofUrl('https://user-images.githubusercontent.com/123/image.png'), true);
  assert.equal(isAcceptedProofUrl('https://example.com/image.png'), false);
  assert.equal(isAcceptedProofUrl('https://raw.githubusercontent.com/KeepOak/Branch-Agent/main/proof/changed-panel.png'), false);
});

test('hasScreenshotProof detects SHA-pinned raw proof URLs', () => {
  assert.equal(hasScreenshotProof(`Here is a screenshot:\n![Demo](${RAW_PROOF})`), true);
  assert.equal(hasScreenshotProof(RAW_PROOF), true);
});

test('hasScreenshotProof detects GitHub user-attachments links', () => {
  assert.equal(hasScreenshotProof(ATTACHMENT), true);
  assert.equal(hasScreenshotProof('See https://github.com/user-attachments/assets/abcd-efgh'), true);
  assert.equal(hasScreenshotProof('![App](https://github.com/user-attachments/assets/abcd-efgh)'), true);
});

test('hasScreenshotProof rejects arbitrary and relative images', () => {
  assert.equal(hasScreenshotProof('Here is a screenshot:\n![Demo](https://example.com/image.png)'), false);
  assert.equal(hasScreenshotProof('See: <img src="screenshot.png" />'), false);
  assert.equal(hasScreenshotProof('<img src="demo.png" alt="Demo" />'), false);
});

test('hasScreenshotProof detects opt-out phrase', () => {
  assert.equal(hasScreenshotProof('No visible change: internal refactor'), true);
  assert.equal(hasScreenshotProof('No Visible Change: type-only edit'), true);
  assert.equal(hasScreenshotProof('No visible change:'), false);
});

test('hasScreenshotProof returns false for body without proof', () => {
  assert.equal(hasScreenshotProof('This PR fixes a bug'), false);
  assert.equal(hasScreenshotProof('Updated the component logic'), false);
  assert.equal(hasScreenshotProof(''), false);
  assert.equal(hasScreenshotProof(null), false);
});

const cursorAgentFooter = '<div><a href="https://cursor.com/agents/bc-example?cursor_ref=pr_footer&cursor_cta=open_in_web"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/open-in-web-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/open-in-web-light.png"><img alt="Open in Web" width="114" height="28" src="https://cursor.com/assets/images/open-in-web-dark.png"></picture></a>&nbsp;<a href="https://cursor.com/background-agent?bcId=bc-example&cursor_ref=pr_footer&cursor_cta=open_in_cursor"><picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/open-in-cursor-dark.png"><source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/open-in-cursor-light.png"><img alt="Open in Cursor" width="131" height="28" src="https://cursor.com/assets/images/open-in-cursor-dark.png"></picture></a>&nbsp;</div>';

test('hasScreenshotProof rejects Cursor footer images and shields badges', () => {
  assert.equal(hasScreenshotProof(cursorAgentFooter), false);
  assert.equal(hasScreenshotProof('![ci](https://img.shields.io/badge/ci-passing-green)'), false);
  assert.equal(hasScreenshotProof('<img src="https://cursor.com/assets/images/open-in-web-dark.png" />'), false);
});

test('checkUIProof fails when a window UI PR only has the Cursor agent footer', () => {
  const result = checkUIProof(['window/src/composer/Composer.tsx'], cursorAgentFooter);
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /window\/src\/composer\/Composer\.tsx/);
});

test('checkUIProof passes a user-attachments shot even when the Cursor footer is present', () => {
  const body = `${cursorAgentFooter}\n\n![App](${ATTACHMENT})`;
  const result = checkUIProof(['window/src/composer/Composer.tsx'], body);
  assert.equal(result.exitCode, 0);
  assert.match(result.message, /screenshot proof/);
});

test('checkUIProof passes when no window UI files changed', () => {
  const files = ['engine/src/agent.ts', 'desktop/scripts/config.mjs', 'window/src/test.test.tsx'];
  const result = checkUIProof(files, '');
  assert.equal(result.exitCode, 0);
  assert.match(result.message, /No window UI source changes/);
});

test('checkUIProof passes when window UI files changed and a sanctioned screenshot is present', () => {
  const files = ['window/src/composer/Composer.tsx', 'window/src/setup/SetupFlow.tsx'];
  const body = `Changes:\n![Screenshot](${RAW_PROOF})`;
  const result = checkUIProof(files, body);
  assert.equal(result.exitCode, 0);
  assert.match(result.message, /screenshot proof/);
});

test('checkUIProof passes when window UI files changed and opt-out present', () => {
  const files = ['window/src/utils.ts'];
  const body = 'No visible change: internal utility refactor';
  const result = checkUIProof(files, body);
  assert.equal(result.exitCode, 0);
});

test('checkUIProof fails when window UI files changed without screenshot', () => {
  const files = ['window/src/composer/Composer.tsx', 'window/src/main.tsx'];
  const body = 'Updated the UI components';
  const result = checkUIProof(files, body);
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /Window UI changes detected/);
  assert.match(result.message, /window\/src\/composer\/Composer\.tsx/);
  assert.match(result.message, /window\/src\/main\.tsx/);
  assert.match(result.message, /AGENTS\.md/);
  assert.match(result.message, /No visible change:/);
  assert.match(result.message, /proof\/<head-branch>/);
});

test('checkUIProof ignores test files in window directory', () => {
  const files = ['window/src/composer/Composer.tsx', 'window/src/composer/Composer.test.tsx'];
  const body = `![Demo](${ATTACHMENT})`;
  const result = checkUIProof(files, body);
  assert.equal(result.exitCode, 0);
  assert.match(result.message, /1 file\(s\)/); // Only counts Composer.tsx
});

const CURSOR_AGENT_FOOTER = [
  '<div><a href="https://cursor.com/agents/bc-example?cursor_ref=pr_footer&cursor_cta=open_in_web">',
  '<picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/open-in-web-dark.png">',
  '<source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/open-in-web-light.png">',
  '<img alt="Open in Web" width="114" height="28" src="https://cursor.com/assets/images/open-in-web-dark.png"></picture></a>',
  '&nbsp;<a href="https://cursor.com/background-agent?bcId=bc-example&cursor_ref=pr_footer&cursor_cta=open_in_cursor">',
  '<picture><source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/assets/images/open-in-cursor-dark.png">',
  '<source media="(prefers-color-scheme: light)" srcset="https://cursor.com/assets/images/open-in-cursor-light.png">',
  '<img alt="Open in Cursor" width="131" height="28" src="https://cursor.com/assets/images/open-in-cursor-dark.png"></picture></a>&nbsp;</div>',
].join('');

test('checkUIProof fails when a window tsx change has only the Cursor agent footer', () => {
  const files = ['window/src/composer/Composer.tsx'];
  const body = [
    'Updated the composer.',
    '',
    '<!-- CURSOR_AGENT_PR_BODY_END -->',
    CURSOR_AGENT_FOOTER,
  ].join('\n');
  const result = checkUIProof(files, body);
  assert.equal(hasScreenshotProof(body), false);
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /window\/src\/composer\/Composer\.tsx/);
});

test('checkUIProof fails when a window tsx change has only badge images', () => {
  const files = ['window/src/composer/Composer.tsx'];
  const body = [
    '[![CI](https://img.shields.io/github/actions/workflow/status/KeepOak/Branch-Agent/ci.yml)](https://github.com/KeepOak/Branch-Agent/actions)',
    '![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)',
    '<img alt="build" src="https://github.com/KeepOak/Branch-Agent/actions/workflows/ci.yml/badge.svg">',
  ].join('\n');
  const result = checkUIProof(files, body);
  assert.equal(hasScreenshotProof(body), false);
  assert.equal(result.exitCode, 1);
});

test('checkUIProof passes when a window tsx change has a real screenshot', () => {
  const files = ['window/src/composer/Composer.tsx'];
  const body = [
    `![Demo](${ATTACHMENT})`,
    '[![CI](https://img.shields.io/badge/ci-passing-green)](https://github.com/KeepOak/Branch-Agent/actions)',
    CURSOR_AGENT_FOOTER,
  ].join('\n');
  const result = checkUIProof(files, body);
  assert.equal(hasScreenshotProof(body), true);
  assert.equal(result.exitCode, 0);
  assert.match(result.message, /screenshot proof/);
});

test('checkUIProof rejects a raw URL pinned to main even when another image is present', () => {
  const files = ['window/src/composer/Composer.tsx'];
  const body = [
    `![Bad](https://raw.githubusercontent.com/KeepOak/Branch-Agent/main/proof/changed-panel.png)`,
    `![Ok](${ATTACHMENT})`,
  ].join('\n');
  assert.deepEqual(rejectedRawProofUrls(body), [
    'https://raw.githubusercontent.com/KeepOak/Branch-Agent/main/proof/changed-panel.png',
  ]);
  const result = checkUIProof(files, body);
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /Rejected raw\.githubusercontent\.com/);
  assert.match(result.message, /main\/proof\/changed-panel\.png/);
});

test('checkUIProof accepts a SHA-pinned raw proof URL without a token', () => {
  const result = checkUIProof(['window/src/composer/Composer.tsx'], `![Demo](${RAW_PROOF})`);
  assert.equal(result.exitCode, 0);
});

test('checkUIProof fails when a proof SHA is on main', () => {
  const result = checkUIProof(
    ['window/src/composer/Composer.tsx'],
    `![Demo](${RAW_PROOF})`,
    { lookupSha: () => ({ onProofBranch: false, onMain: true }) },
  );
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /reachable from main/);
  assert.match(result.message, new RegExp(SHA));
});

test('checkUIProof passes when a proof SHA is on a proof branch', () => {
  const result = checkUIProof(
    ['window/src/composer/Composer.tsx'],
    `![Demo](${RAW_PROOF})`,
    { lookupSha: () => ({ onProofBranch: true, onMain: false }) },
  );
  assert.equal(result.exitCode, 0);
});

test('lookupProofSha uses matching-refs and compare when a request helper is provided', () => {
  const info = lookupProofSha(SHA, {
    token: 'test-token',
    request: (apiPath) => {
      if (apiPath.includes('matching-refs')) {
        return [{ ref: 'refs/heads/proof/cursor/demo', object: { sha: SHA } }];
      }
      if (apiPath.endsWith('...main')) return { status: 'diverged' };
      return { status: 'identical' };
    },
  });
  assert.equal(info.onProofBranch, true);
  assert.equal(info.onMain, false);
});

test('lookupProofSha reports a SHA that is an ancestor of main', () => {
  const info = lookupProofSha(SHA, {
    token: 'test-token',
    request: (apiPath) => {
      if (apiPath.includes('matching-refs')) return [];
      if (apiPath.endsWith('...main')) return { status: 'ahead' };
      return { status: 'diverged' };
    },
  });
  assert.equal(info.onProofBranch, false);
  assert.equal(info.onMain, true);
});

test('lookupProofSha returns null without a token or request helper', () => {
  assert.equal(lookupProofSha(SHA, {}), null);
});

test('checkPrProof fails when the diff adds a screenshot under docs/proof', () => {
  const result = checkPrProof(
    ['docs/proof/side-panel.png', 'window/src/composer/Composer.tsx'],
    `![Demo](${ATTACHMENT})`,
  );
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /docs\/proof\/side-panel\.png/);
  assert.match(result.message, /proof\/<head-branch>/);
});

test('checkPrProof allows a window UI change with an attachment and no new images', () => {
  const result = checkPrProof(
    [{ filename: 'window/src/composer/Composer.tsx', status: 'modified' }],
    `![Demo](${ATTACHMENT})`,
  );
  assert.equal(result.exitCode, 0);
});
