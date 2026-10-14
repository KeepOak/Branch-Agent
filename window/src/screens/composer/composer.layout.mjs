// Run from window/: node src/screens/composer/composer.layout.mjs [proof-output-directory]
// Isolated composer proof (HANDOFF 4.2, the preview's branchLayoutTestP17): the production Frame, Composer and CSS
// against a fixture engine that answers only what the composer reads. Nothing here ships.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const output = resolve(process.argv[2] ?? `${tmpdir()}/r1-composer-proof`);
const html = resolve(root, '.r1-composer-proof.html'), entry = resolve(root, '.r1-composer-proof.tsx');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const ENTRY = `import { createRoot } from 'react-dom/client';
import './src/theme/tokens.css'; import './src/theme/base.css';
import { Frame } from './src/screens/frame/Frame';
import { Composer } from './src/screens/composer/Composer';
import { Face } from './src/face/Face';
const levels=[{id:'low',label:'low'},{id:'medium',label:'medium'},{id:'high',label:'high'}];
const answers={
  'agents.list':{defaultId:'fixture',agents:[{id:'fixture',name:'Fixture'}]},
  'sessions.describe':{session:{model:'fixture/model',permissionMode:'guarded',thinkingLevel:'medium'}},
  'sessions.list':{defaults:{model:'fixture/model'},sessions:[]},
  'models.list':{models:[{id:'model',provider:'fixture',name:'Fixture model',available:true,thinkingLevels:levels}]},
  'models.authStatus':{providers:[]},
};
const engine={sessionKey:'agent:fixture:main',agentId:'fixture',scopes:['operator.admin'],onEvent:()=>()=>{},request:async(method)=>answers[method]??{}};
const limits={updatedAt:0,refreshing:false,rows:[{id:'a',name:'Fixture account',provider:'fixture',email:'',account:'',pill:'Measured',line:'',windows:[{name:'5-hour',left:61,reset:'',low:false},{name:'Week',left:30,reset:'',low:false}]}]};
const row={key:'agent:fixture:main',title:'Main',isMain:true,totalTokens:36000,contextTokens:256000};
const noop=()=>{};
createRoot(document.getElementById('root')!).render(<Frame sidebar={<div className="r1-sidebar-list"/>} main={<div/>} header={{title:'Conversation',face:<Face size={24}/>}}
  composer={<Composer name="Fixture" engine={engine as never} working={false} offline={false} onSend={noop} onStop={noop} onToast={noop} onOpen={noop} onOpenConversation={noop}
    limits={limits as never} row={row as never} topics={[{key:'agent:fixture:t1',title:'Topic'}]} running={[]} />}/>);`;
let vite, browser;
try {
  await mkdir(output, { recursive: true });
  await writeFile(html, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.r1-composer-proof.tsx"></script></body></html>', { flag: 'wx' });
  await writeFile(entry, ENTRY, { flag: 'wx' });
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], { cwd: root, stdio: 'ignore', windowsHide: true });
  const url = `http://127.0.0.1:${port}/.r1-composer-proof.html`;
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(url)).ok) break; } catch { /* Wait for this scratch server only. */ }
    if (tries > 100) throw new Error('Scratch Vite did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const separate = (rects, what) => {
    for (const [i, rect] of rects.entries()) for (const other of rects.slice(i + 1))
      assert(rect.right <= other.left + .5 || other.right <= rect.left + .5, `${what} overlap`);
  };
  let layouts = 0, shots = 0;
  for (const theme of ['light', 'dark']) for (const width of [390,768,1024,1180,1280,1366,1440,1600,1920,2560]) {
    const height = width === 390 ? 844 : 900;
    await page.setViewportSize({ width, height });
    await page.goto(url);
    await page.evaluate(theme => { localStorage.clear(); sessionStorage.clear(); document.documentElement.dataset.theme = theme; }, theme);
    await page.reload();
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.getByRole('button', { name: 'Fixture model' }).waitFor();
    const g = await page.evaluate(() => {
      const box = node => node.getBoundingClientRect().toJSON();
      const shown = node => getComputedStyle(node).display !== 'none';
      return {
        column: box(document.querySelector('.r1-conversation')), pill: box(document.querySelector('.r1c-pill')), row: box(document.querySelector('.r1c-row')),
        controls: [...document.querySelectorAll('.r1c-pill > button, .r1c-pill > .g-ring')].filter(shown).map(box),
        quiet: [...document.querySelectorAll('.r1c-row .r1c-quiet')].filter(shown).map(box),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    const at = `${theme}/${width}`;
    assert.equal(g.overflow, false, `viewport overflow at ${at}`);
    assert(g.pill.left >= g.column.left && g.pill.right <= g.column.right + .5, `pill crosses the column at ${at}`);
    assert(Math.abs(g.pill.height - 54) < 1, `pill is ${g.pill.height} tall at ${at}`);
    for (const c of g.controls) assert(c.left >= g.pill.left && c.right <= g.pill.right && c.top >= g.pill.top && c.bottom <= g.pill.bottom, `pill control crosses the pill at ${at}`);
    separate(g.controls, `pill controls at ${at}`);
    separate(g.quiet, `row buttons at ${at}`);
    assert(g.row.top >= g.pill.bottom, `row sits over the pill at ${at}`);
    layouts++;
    if (![390, 1440].includes(width)) continue;
    const shot = async name => { await page.waitForTimeout(600); await page.screenshot({ path: resolve(output, `${width}-${theme}${name}.png`) }); shots++; };
    await shot('');
    await page.getByRole('button', { name: 'Attach, mention a Trunk, skills' }).click();
    await page.waitForSelector('.r1c-plus');
    await shot('-plus');
    await page.keyboard.press('Escape');
    await page.locator('.g-ring').click();
    await page.waitForSelector('.r1c-ringpop');
    const pop = await page.locator('.g-popover').evaluate(node => node.getBoundingClientRect().toJSON());
    assert(pop.top >= 0 && pop.bottom <= height && pop.left >= 0 && pop.right <= width, `ring popover leaves the window at ${at}`);
    await shot('-ring');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Ask first' }).click();
    await page.waitForSelector('[data-testid="mode-option"]');
    await shot('-permission');
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="composer"]').fill('Find the invoice');
    await page.waitForSelector('.r1c-send');
    await shot('-send');
  }
  assert.deepEqual(errors, []);
  console.log(`${layouts} composer layouts passed; ${shots} screenshots in ${output}.`);
} finally {
  await browser?.close();
  if (vite) { vite.kill(); await new Promise(resolve => { if (vite.exitCode !== null) resolve(); else vite.once('exit', resolve); }); }
  await Promise.all([html, entry].map(path => unlink(path).catch(() => undefined)));
}
