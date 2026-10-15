// Run from window/: node src/screens/sidebar/sidebar.layout.mjs [proof-output-directory]
// The preview's branchLayoutTestP17 for the sidebar: the real Frame and Sidebar with a fixed fake engine (test data
// lives only in this proof), at every width in light and dark, wide and rail. No two sidebar controls overlap, none
// crosses the sidebar's edge, the page never scrolls sideways, and the avatar never shrinks.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const output = resolve(process.argv[2] ?? `${tmpdir()}/r1-sidebar-proof`);
const html = resolve(root, '.r1-sidebar-proof.html'), entry = resolve(root, '.r1-sidebar-proof.tsx');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
let vite, browser;
try {
  await mkdir(output, { recursive: true });
  await writeFile(html, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.r1-sidebar-proof.tsx"></script></body></html>', { flag: 'wx' });
  await writeFile(entry, `import { createRoot } from 'react-dom/client';
import './src/theme/tokens.css'; import './src/theme/base.css';
import { Frame } from './src/screens/frame/Frame';
import { Sidebar } from './src/screens/sidebar/Sidebar';
const c = (id, kind, name, x = {}) => ({ id, kind, name, threadKey: 'agent:' + id.split(':')[1] + ':main', isDefault: false, lastActivityAt: 10, preview: { kind: 'message', text: name + ' finished the weekly summary and is waiting for review', at: Date.now() - 3600e3 }, unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0, ...x });
const data = {
  'contacts.list': { contacts: [c('trunk:sapling', 'trunk', 'Sapling', { isDefault: true, pinnedAt: 1 }), c('trunk:scout', 'trunk', 'Scout with a very long name indeed', { pinnedAt: 2 }), c('trunk:ledger', 'trunk', 'Ledger', { threadUnread: true }), c('trunk:ada', 'trunk', 'Ada', { needsYou: true }), c('a2a:cc', 'outside', 'Claude Code')] },
  'agents.list': { defaultId: 'sapling', agents: ['sapling', 'scout', 'ledger', 'ada'].map(id => ({ id, identity: { name: id } })) },
  'rooms.list': { rooms: [{ roomId: 'r1', name: 'Supplier quotes', lead: 'sapling', createdAt: 5, members: ['sapling', 'scout', 'ledger', 'ada', 'x'].map(id => ({ kind: 'trunk', id })) }] },
  'a2a.peers.list': { peers: [] }, 'users.self': { profile: { id: 'me', displayName: 'Taofik' } },
  'users.list': { profiles: [{ id: 'me', displayName: 'Taofik' }, { id: 'dana', displayName: 'Dana Okafor', role: 'member' }] },
};
const request = async m => data[m] ?? {};
const session = { request, onGatewayEvent: () => () => undefined, engine: { request, features: { methods: Object.keys(data), events: [] } }, gatewayUrl: 'ws://127.0.0.1:1', open: async () => undefined, send: () => undefined };
const list = { refresh: async () => undefined, getSnapshot: () => ({ rows: [] }) };
createRoot(document.getElementById('root')).render(<Frame sidebar={<Sidebar session={session} ready list={list} sessions={[]} mainKey="main" currentKey="agent:ledger:main" waiting={new Map()} searchRef={{ current: null }} onOpen={() => undefined} onSettings={() => undefined} onPlace={() => undefined} />} main={<div />} header={{ title: 'Ledger' }} />);`, { flag: 'wx' });
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], { cwd: root, stdio: 'ignore', windowsHide: true });
  const url = `http://127.0.0.1:${port}/.r1-sidebar-proof.html`;
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(url)).ok) break; } catch { /* Wait for this scratch server only. */ }
    if (tries > 100) throw new Error('Scratch Vite did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let layouts = 0;
  for (const theme of ['light', 'dark']) for (const width of [390, 768, 1024, 1180, 1280, 1366, 1440, 1600, 1920, 2560]) for (const rail of [false, true]) {
    if (width === 390 && rail) continue;
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(url);
    await page.evaluate(({ theme, rail }) => { localStorage.setItem('branch.r1.sidebar', rail ? 'rail' : 'wide'); localStorage.setItem('branch.theme', theme); }, { theme, rail });
    await page.goto(url);
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    if (width === 390) { await page.locator('.r1-drawer-button').first().click(); await page.waitForFunction(() => getComputedStyle(document.querySelector('.r1-sidebar')).translate === 'none'); }
    await page.waitForSelector('.r1sb-row');
    await page.waitForTimeout(450);
    const g = await page.evaluate(() => {
      const side = document.querySelector('.r1-sidebar').getBoundingClientRect().toJSON();
      const shown = node => { const s = getComputedStyle(node); return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > 0.01 && node.getBoundingClientRect().width > 0; };
      const controls = [...document.querySelectorAll('.r1sb-caps > *, .r1sb-fold, .r1sb-me, .r1sb-seed, .r1sb-upd')].filter(shown).map(node => ({ name: node.className || node.tagName, ...node.getBoundingClientRect().toJSON() }));
      const rows = [...document.querySelectorAll('.r1sb-row, .r1sb-pin-open')].filter(shown).map(node => node.getBoundingClientRect().toJSON());
      return { side, controls, rows, me: document.querySelector('.r1sb-me').getBoundingClientRect().width, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    const at = `${theme}/${width}/${rail ? 'rail' : 'wide'}`;
    assert.equal(g.overflow, false, `viewport overflow at ${at}`);
    assert.equal(g.me, 36, `avatar shrank at ${at}`);
    for (const [i, rect] of g.controls.entries()) {
      assert(rect.left >= g.side.left - .5 && rect.right <= g.side.right + .5, `${rect.name} crosses the sidebar edge at ${at}`);
      for (const other of g.controls.slice(i + 1)) assert(rect.right <= other.left + .5 || other.right <= rect.left + .5 || rect.bottom <= other.top + .5 || other.bottom <= rect.top + .5, `${rect.name} overlaps ${other.name} at ${at}`);
    }
    for (const rect of g.rows) assert(rect.left >= g.side.left - .5 && rect.right <= g.side.right + .5, `a row crosses the sidebar edge at ${at}`);
    layouts++;
    if ([390, 1440].includes(width)) await page.screenshot({ path: resolve(output, `${width}-${theme}${rail ? '-rail' : ''}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log(`${layouts} sidebar layouts passed; screenshots in ${output}`);
} finally {
  await browser?.close();
  if (vite) { vite.kill(); await new Promise(resolve => { if (vite.exitCode !== null) resolve(); else vite.once('exit', resolve); }); }
  await Promise.all([html, entry].map(path => unlink(path).catch(() => undefined)));
}
