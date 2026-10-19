// Open in browser (#1932): the app hands the browser only the engine's one-time pairing code, never the Gateway secret.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error('Compile the exact desktop source before testing');
const require = createRequire(import.meta.url);
const { DASHBOARD_HANDOFF_ARGS, pickBrowserHandoffUrl, openInBrowser } = require(join(process.env.BRANCH_DESKTOP_TEST_DIST, 'open-in-browser.js'));

const PORT = 19031;
const CODE = 'one-time-code-1234';
const answer = (fields) => JSON.stringify({ ok: true, ...fields });
const good = `http://127.0.0.1:${PORT}/#bootstrapToken=${CODE}&gatewayUrl=ws%3A%2F%2F127.0.0.1%3A${PORT}`;

test('asks the engine for a two-minute JSON pairing link', () => {
  assert.deepEqual([...DASHBOARD_HANDOFF_ARGS], ['branch.mjs', 'dashboard', '--json', '--ttl-seconds', '120']);
});

test('accepts a loopback link on the live port carrying a one-time code', () => {
  assert.equal(new URL(pickBrowserHandoffUrl(answer({ browserUrl: good }), PORT)).hash.includes(CODE), true);
  for (const host of ['localhost', '[::1]']) {
    assert.doesNotThrow(() => pickBrowserHandoffUrl(answer({ browserUrl: good.replace('127.0.0.1:', `${host}:`) }), PORT));
  }
});

test('reads the last JSON object even after engine log lines', () => {
  const stdout = `starting...\n{"ok":false}\nnoise\n${JSON.stringify({ ok: true, browserUrl: good }, null, 2)}\n`;
  assert.equal(pickBrowserHandoffUrl(stdout, PORT).includes(CODE), true);
});

test('refuses links that are not this Gateway, carry the secret, or lack a code, without quoting the answer', () => {
  const refused = [
    'not json',
    JSON.stringify({ ok: false, browserUrl: good }),
    answer({}),
    answer({ browserUrl: 'not a url SECRET' }),
    answer({ browserUrl: good.replace('http:', 'file:') }),
    answer({ browserUrl: good.replace('127.0.0.1', 'example.com') }),
    answer({ browserUrl: good.replace(`:${PORT}`, ':19032') }),
    answer({ browserUrl: good.replace('http://', 'http://u:SECRET@') }),
    answer({ browserUrl: `${good}&token=SECRET` }),
    answer({ browserUrl: good.replace('/#', '/?token=SECRET#') }),
    answer({ browserUrl: `${good}&password=SECRET` }),
    answer({ browserUrl: `http://127.0.0.1:${PORT}/#gatewayUrl=x` }),
  ];
  for (const stdout of refused) {
    assert.throws(() => pickBrowserHandoffUrl(stdout, PORT), (error) => !String(error.message).includes('SECRET'), stdout);
  }
});

test('openInBrowser issues a fresh link per click and logs only plain lines on failure', async () => {
  const logs = [];
  const opened = [];
  let issued = 0;
  const steps = {
    issue: async () => { issued += 1; return answer({ browserUrl: good }); },
    port: () => PORT,
    open: async (url) => { opened.push(url); },
    log: (line) => logs.push(line),
  };
  assert.equal(await openInBrowser(steps), true);
  assert.equal(await openInBrowser(steps), true);
  assert.equal(issued, 2);
  assert.equal(opened.length, 2);
  assert.equal(await openInBrowser({ ...steps, issue: async () => { throw Error('stderr SECRET'); } }), false);
  assert.equal(await openInBrowser({ ...steps, issue: async () => answer({ browserUrl: `${good}&token=SECRET` }) }), false);
  assert.equal(await openInBrowser({ ...steps, open: async () => { throw Error('browser SECRET'); } }), false);
  assert.equal(logs.some((line) => line.includes('SECRET')), false);
  assert.equal(logs.filter((line) => line.startsWith('open in browser failed:')).length, 3);
});
