// A console-error used to be stored as the tag alone. These checks fail on that behaviour:
// the entry, the gate log, and the markdown report must carry the console text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatGate } from './baseline.mjs';
import {
  MAX_CONSOLE_CHARS,
  MAX_CONSOLE_PER_KEY,
  addConsoleEvidence,
} from './console-evidence.mjs';
import { markdownReport } from './report.mjs';

const KEY = 'settings:goto@regular > Learn more :: (open)';

test('a console-error entry carries its text', () => {
  const evidence = {};
  addConsoleEvidence(evidence, KEY, [{
    text: 'TypeError: fail',
    stack: 'TypeError: fail\n    at open (window/src/learn.tsx:4:2)',
  }], { screenshot: 'button-crawl-output/settings-goto-regular-learn-more-open.jpg' });
  const entry = evidence[KEY];
  assert.equal(entry.messages[0].text, 'TypeError: fail');
  assert.match(entry.messages[0].stack, /at open \(window\/src\/learn\.tsx:4:2\)/);
  const gate = formatGate({ news: [{ key: KEY, problem: 'console-error' }], stale: [] }, evidence).join('\n');
  assert.match(gate, /New button-crawl problem: settings:goto@regular > Learn more :: \(open\) \[console-error\]/);
  assert.match(gate, /text: TypeError: fail/);
  assert.match(gate, /at open \(window\/src\/learn\.tsx:4:2\)/);
  assert.match(gate, /screenshot: button-crawl-output\/settings-goto-regular-learn-more-open\.jpg/);
  const markdown = markdownReport({
    consoleEvidence: evidence,
    gated: { [KEY]: ['console-error'] },
  });
  assert.match(markdown, /## Console errors/);
  assert.match(markdown, /TypeError: fail/);
  assert.match(markdown, /window\/src\/learn\.tsx:4:2/);
});

test('console evidence caps each message and strips local details', () => {
  const root = '/repo/branch';
  const evidence = {};
  const messages = Array.from({ length: MAX_CONSOLE_PER_KEY + 3 }, (_, index) => ({
    text: index === 0
      ? `person@example.com api_key=abcd1234 /repo/branch/window/src/a.tsx:2:1 /home/person/notes/file.js:3:1 DESKTOP-AB12CD http://127.0.0.1:5653/@fs/repo/branch/window/src/a.tsx ${'E'.repeat(MAX_CONSOLE_CHARS)}`
      : `extra ${index}`,
    stack: `at read (/repo/branch/engine/src/b.ts:8:1)\n${'S'.repeat(MAX_CONSOLE_CHARS)}`,
  }));
  addConsoleEvidence(evidence, 'place:overview :: Export', messages, {
    root,
    screenshot: '/repo/branch/button-crawl-output/export.jpg',
  });
  const entry = evidence['place:overview :: Export'];
  assert.equal(entry.messages.length, MAX_CONSOLE_PER_KEY);
  assert.ok(entry.messages[0].text.length <= MAX_CONSOLE_CHARS);
  assert.ok(entry.messages[0].stack.length <= MAX_CONSOLE_CHARS);
  assert.equal(entry.messages[0].text.includes('person@example.com'), false);
  assert.equal(entry.messages[0].text.includes('abcd1234'), false);
  assert.equal(entry.messages[0].text.includes('/repo/branch'), false);
  assert.equal(entry.messages[0].text.includes('/home/person'), false);
  assert.equal(entry.messages[0].text.includes('notes'), false);
  assert.equal(entry.messages[0].text.includes('DESKTOP-AB12CD'), false);
  assert.match(entry.messages[0].text, /window\/src\/a\.tsx:2:1/);
  assert.match(entry.messages[0].text, /http:\/\/127\.0\.0\.1:5653\/window\/src\/a\.tsx/);
  assert.match(entry.messages[0].stack, /engine\/src\/b\.ts:8:1/);
  assert.equal(entry.messages[0].stack.includes('/repo/branch'), false);
  assert.equal(entry.screenshot, 'button-crawl-output/export.jpg');

  const outside = {};
  addConsoleEvidence(outside, 'k', [{ text: 'x', stack: '' }], { root, screenshot: '/home/person/shot.jpg' });
  assert.equal(outside.k.screenshot, undefined);
  assert.equal(outside.k.messages[0].text, 'x');
});
