import assert from 'node:assert/strict';
import test from 'node:test';
import { checkUIProof, hasScreenshotProof, isWindowUISource } from './check-ui-proof.mjs';

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

test('hasScreenshotProof detects markdown images', () => {
  assert.equal(hasScreenshotProof('Here is a screenshot:\n![Demo](https://example.com/image.png)'), true);
  assert.equal(hasScreenshotProof('![Before](url1) and ![After](url2)'), true);
});

test('hasScreenshotProof detects HTML images', () => {
  assert.equal(hasScreenshotProof('See: <img src="screenshot.png" />'), true);
  assert.equal(hasScreenshotProof('<img src="demo.png" alt="Demo" />'), true);
  assert.equal(hasScreenshotProof('Look: <img alt="Test" src="test.png">'), true);
});

test('hasScreenshotProof detects GitHub user-attachments links', () => {
  assert.equal(hasScreenshotProof('https://user-images.githubusercontent.com/123/image.png'), true);
  assert.equal(hasScreenshotProof('See https://github.com/user-attachments/assets/abcd-efgh'), true);
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
  const body = `${cursorAgentFooter}\n\n![App](https://github.com/user-attachments/assets/abcd-efgh)`;
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

test('checkUIProof passes when window UI files changed and screenshot present', () => {
  const files = ['window/src/composer/Composer.tsx', 'window/src/setup/SetupFlow.tsx'];
  const body = 'Changes:\n![Screenshot](https://example.com/demo.png)';
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
});

test('checkUIProof ignores test files in window directory', () => {
  const files = ['window/src/composer/Composer.tsx', 'window/src/composer/Composer.test.tsx'];
  const body = '![Demo](https://example.com/demo.png)';
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
    '![Demo](https://github.com/user-attachments/assets/abcd-efgh)',
    '[![CI](https://img.shields.io/badge/ci-passing-green)](https://github.com/KeepOak/Branch-Agent/actions)',
    CURSOR_AGENT_FOOTER,
  ].join('\n');
  const result = checkUIProof(files, body);
  assert.equal(hasScreenshotProof(body), true);
  assert.equal(result.exitCode, 0);
  assert.match(result.message, /screenshot proof/);
});
