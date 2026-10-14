// Run from window/: node src/screens/onboarding/onboarding.layout.mjs [proof-output-directory]
// Isolated onboarding layout proof (HANDOFF §4.2, the preview's branchLayoutTestP17): production components and CSS
// against a stub engine that answers detect, config, the template list and the Trunk list only. At every width, in light and
// dark, on steps 1–4: nothing overflows the viewport, every control stays inside the card, and no two controls overlap. The
// page wears a colourful stand-in wallpaper so the screenshots show the clear glass (README item 48).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const output = resolve(process.argv[2] ?? `${tmpdir()}/r1-onboarding-proof`);
const html = resolve(root, '.r1-ob-layout-proof.html'), entry = resolve(root, '.r1-ob-layout-proof.tsx');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
let vite, browser;
try {
  await mkdir(output, { recursive: true });
  await writeFile(html, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.r1-ob-layout-proof.tsx"></script></body></html>', { flag: 'wx' });
  await writeFile(entry, `import { createRoot } from 'react-dom/client';
import './src/theme/tokens.css'; import './src/theme/base.css'; import './src/shell/frame.css'; import './src/shell/controls.css';
import { Onboarding } from './src/screens/onboarding';
const q = new URLSearchParams(location.search);
const answers: Record<string, unknown> = {
  'branch.setup.detect': { candidates: [{ kind: 'claude-cli', modelRef: 'anthropic/claude', label: 'Claude Code', detail: 'installed; login status unverified', credentials: true }, { kind: 'codex-cli', modelRef: 'openai/gpt', label: 'Codex', detail: 'installed; stored credentials found; login status unverified', credentials: true }] },
  'config.get': { hash: 'h', valid: true, config: {} },
  'trunks.template.list': { templates: ['trunk-doctor', 'mentions-watch', 'home-desk', 'project-lead', 'prospect-finder', 'search-brief-desk', 'spend-saver', 'hiring-desk'].map(id => ({ id, name: id })) },
  'agents.list': { defaultId: 'sapling', mainKey: 'main', agents: [{ id: 'sapling', identity: { name: 'Sapling' } }] },
};
document.body.style.background = 'linear-gradient(135deg, #f6b26b 0%, #e06666 30%, #8e7cc3 60%, #6fa8dc 100%) fixed';
const engine = { request: async (m: string) => answers[m] ?? {}, onEvent: () => () => {}, sessionKey: null, agentId: 'main', scopes: [] };
createRoot(document.getElementById('root')!).render(<Onboarding engine={engine} startAt={Number(q.get('step'))} onLater={() => {}} onAnswered={() => {}} />);`, { flag: 'wx' });
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], { cwd: root, stdio: 'ignore', windowsHide: true });
  const url = `http://127.0.0.1:${port}/.r1-ob-layout-proof.html`;
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(url)).ok) break; } catch { /* Wait for this scratch server only. */ }
    if (tries > 100) throw new Error('Scratch Vite did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let layouts = 0;
  for (const theme of ['light', 'dark']) for (const width of [390,768,1024,1180,1280,1366,1440,1600,1920,2560]) for (const step of [0, 1, 2, 3]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(`${url}?step=${step}`);
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.waitForSelector('.r1-ob-card');
    if (step === 1) await page.waitForSelector('.r1-ob-row');
    if (step === 3) { await page.waitForSelector('.r1-ob-chip:not([aria-disabled])'); await page.fill('.r1-ob-text', 'I chase receipts and invoices, and my kids’ school forms'); await page.click('.r1-ob-pick'); }
    await page.waitForTimeout(450);
    const geometry = await page.evaluate(() => {
      const card = document.querySelector('.r1-ob-card').getBoundingClientRect().toJSON();
      const controls = [...document.querySelectorAll('.r1-ob-card button, .r1-ob-card [role=radio], .r1-ob-card [role=switch], .r1-ob-card textarea')].filter(node => getComputedStyle(node).display !== 'none').map(node => ({ name: node.textContent.trim() || node.getAttribute('aria-label'), rect: node.getBoundingClientRect().toJSON() }));
      const go = document.querySelector('.r1-ob-go').getBoundingClientRect().toJSON();
      return { card, controls, go, overflow: document.documentElement.scrollWidth > innerWidth, height: innerHeight };
    });
    const where = `${theme}/${width}/step ${step + 1}`;
    assert.equal(geometry.overflow, false, `viewport overflow at ${where}`);
    assert(geometry.go.bottom <= geometry.height + .5, `the primary button is below the fold at ${where}`);
    for (const [i, { name, rect }] of geometry.controls.entries()) {
      assert(rect.left >= geometry.card.left - .5 && rect.right <= geometry.card.right + .5, `${name} crosses the card at ${where}`);
      for (const other of geometry.controls.slice(i + 1)) {
        const apart = rect.right <= other.rect.left + .5 || other.rect.right <= rect.left + .5 || rect.bottom <= other.rect.top + .5 || other.rect.bottom <= rect.top + .5;
        assert(apart, `${name} overlaps ${other.name} at ${where}`);
      }
    }
    layouts++;
    if ([390, 1440].includes(width)) await page.screenshot({ path: resolve(output, `step${step + 1}-${width}-${theme}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log(`${layouts} responsive onboarding layouts passed; 16 screenshots.`);
} finally {
  await browser?.close();
  if (vite) { vite.kill(); await new Promise(resolve => { if (vite.exitCode !== null) resolve(); else vite.once('exit', resolve); }); }
  await Promise.all([html, entry].map(path => unlink(path).catch(() => undefined)));
}
