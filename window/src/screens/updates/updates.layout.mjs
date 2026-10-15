// Run from window/: node src/screens/updates/updates.layout.mjs [proof-output-directory]
// Isolated update button and banner proof: production components/CSS in the R1 frame, a stand-in desktop updater
// bridge (status/stage/install only), no engine or demo data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const output = resolve(process.argv[2] ?? `${tmpdir()}/r1-updates-proof`);
const html = resolve(root, '.r1-updates-proof.html'), entry = resolve(root, '.r1-updates-proof.tsx');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
let vite, browser;
try {
  await mkdir(output, { recursive: true });
  await writeFile(html, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.r1-updates-proof.tsx"></script></body></html>', { flag: 'wx' });
  await writeFile(entry, `import { createRoot } from 'react-dom/client';
import './src/theme/tokens.css'; import './src/theme/base.css';
import { Frame } from './src/screens/frame/Frame';
import { Face } from './src/face/Face';
import { UpdateBanner, UpdateButton, useUpdateFlow } from './src/screens/updates';
const q = new URLSearchParams(location.search), state = q.get('state') ?? 'available', url = 'ws://127.0.0.1:1/';
const status = { phase: state === 'installing' ? 'staging' : state, currentVersion: '0.4.4', latestVersion: '0.5.0', pendingVersion: state === 'staged' ? '0.5.0' : null, checkedAt: 1, error: null };
(window as any).branchDesktop = { gatewayUrl: url, componentUpdates: { status: async () => status, check: async () => status, stage: () => new Promise(() => {}), install: () => {} } };
const engine = { gatewayUrl: url, request: async () => ({}), onEvent: () => () => {} };
function Proof() {
  const flow = useUpdateFlow(engine, true, '0.4.4');
  const rail = localStorage.getItem('branch.r1.sidebar') === 'rail';
  return <Frame sidebar={<><div className="r1-sidebar-list" /><div data-proof="menu" style={{ margin: '0 8px' }}><UpdateBanner flow={flow} /></div><div className="r1-sidebar-footer" style={{ display: 'flex', flexDirection: rail ? 'column' : 'row', gap: 8, alignItems: 'center' }}><Face size={36} /><UpdateButton flow={flow} rail={rail} /></div></>} main={<div />} header={{ title: 'Conversation', face: <Face size={24} /> }} />;
}
createRoot(document.getElementById('root')!).render(<Proof />);`, { flag: 'wx' });
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], { cwd: root, stdio: 'ignore', windowsHide: true });
  const url = `http://127.0.0.1:${port}/.r1-updates-proof.html`;
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(url)).ok) break; } catch { /* Wait for this scratch server only. */ }
    if (tries > 100) throw new Error('Scratch Vite did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  // Vite optimises dependencies on the first load and then reloads the page once; let that settle first.
  await page.goto(url); await page.waitForSelector('.r1u-btn'); await page.waitForTimeout(3000); await page.goto(url); await page.waitForSelector('.r1u-btn');
  let layouts = 0;
  for (const theme of ['light', 'dark']) for (const width of [390, 1440]) for (const state of ['available', 'installing', 'staged']) for (const rail of [false, true]) {
    if (width === 390 && rail) continue;
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(url);
    await page.evaluate(rail => localStorage.setItem('branch.r1.sidebar', rail ? 'rail' : 'wide'), rail);
    await page.goto(`${url}?state=${state}`);
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    if (width === 390) await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await page.waitForSelector('.r1u-btn');
    await page.waitForTimeout(500);
    const facts = await page.evaluate(() => {
      const side = document.querySelector('.r1-sidebar').getBoundingClientRect(), btn = document.querySelector('.r1u-btn');
      const box = btn.getBoundingClientRect(), style = getComputedStyle(btn);
      const pills = [...document.querySelectorAll('.r1u-ban-text,.r1u-ban-act')].map(node => { const s = getComputedStyle(node); return { border: s.borderTopWidth, blur: s.backdropFilter }; });
      const ban = document.querySelector('.r1u-ban');
      return { inside: box.left >= side.left - .5 && box.right <= side.right + .5, height: box.height, bg: style.backgroundColor, border: style.borderTopWidth,
        pills, banBg: ban ? getComputedStyle(ban).backgroundColor : null, text: btn.textContent, label: btn.getAttribute('aria-label'), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(facts.overflow, false, `viewport overflow at ${width}`);
    assert(facts.inside, `update button spills past the sidebar at ${width}/${state}/${rail}`);
    assert.equal(facts.height, 36);
    assert.equal(facts.bg, 'rgb(255, 255, 255)', 'the button is a solid white disc');
    assert.equal(facts.border, '1px');
    assert.equal(facts.banBg, 'rgba(0, 0, 0, 0)', 'the banner itself is clear glass (README item 48)');
    for (const pill of facts.pills) { assert.equal(pill.border, '1px'); assert.match(pill.blur, /blur/); }
    if (state === 'staged') assert.equal(rail ? facts.text : facts.text, rail ? '↻' : 'Restart Branch');
    if (state === 'available') assert.equal(facts.label, 'Update to 0.5.0');
    if (state === 'installing') assert.match(facts.label, /^Installing 0\.5\.0…/);
    layouts++;
    if (!rail) await page.screenshot({ path: resolve(output, `${width}-${theme}-${state}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log(`${layouts} layouts passed; screenshots in ${output}`);
} finally {
  await browser?.close();
  vite?.kill();
  await unlink(html).catch(() => undefined);
  await unlink(entry).catch(() => undefined);
}
