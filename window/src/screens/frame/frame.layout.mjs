// Run from window/: node src/screens/frame/frame.layout.mjs [proof-output-directory]
// Isolated frame proof: production components/CSS, empty slots, no engine or demo data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const output = resolve(process.argv[2] ?? `${tmpdir()}/r1-frame-proof`);
const html = resolve(root, '.r1-layout-proof.html'), entry = resolve(root, '.r1-layout-proof.tsx');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
let vite, browser;
try {
  await mkdir(output, { recursive: true });
  await writeFile(html, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.r1-layout-proof.tsx"></script></body></html>', { flag: 'wx' });
  await writeFile(entry, `import { createRoot } from 'react-dom/client';
import './src/theme/tokens.css'; import './src/theme/base.css';
import { Frame } from './src/screens/frame/Frame';
import { Face } from './src/face/Face';
const q=new URLSearchParams(location.search);
createRoot(document.getElementById('root')!).render(<Frame sidebar={<div className="r1-sidebar-list"><p className="r1-notice">No conversations yet</p></div>} topics={q.has('topics')?<p className="r1-notice">No topics yet</p>:undefined} main={<div style={{minHeight:q.has('long')?1800:0}}/>} header={{title:'Conversation',face:<Face size={24}/>}}/>);`, { flag: 'wx' });
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port)], { cwd: root, stdio: 'ignore', windowsHide: true });
  const url = `http://127.0.0.1:${port}/.r1-layout-proof.html`;
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(url)).ok) break; } catch { /* Wait for this scratch server only. */ }
    if (tries > 100) throw new Error('Scratch Vite did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let layouts = 0;
  for (const theme of ['light', 'dark']) for (const width of [390,768,1024,1180,1280,1366,1440,1600,1920,2560]) for (const rail of [false,true]) for (const topics of [false,true]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto(url);
    await page.evaluate(({theme,rail}) => { localStorage.setItem('branch.r1.sidebar',rail?'rail':'wide'); document.documentElement.dataset.theme=theme; }, {theme,rail});
    await page.goto(url + (topics ? '?topics' : ''));
    await page.evaluate(theme => { document.documentElement.dataset.theme=theme; },theme);
    await page.waitForSelector('.g-pill');
    await page.waitForFunction(() => document.querySelector('.r1-pill-position')?.style.width);
    const geometry = await page.evaluate(() => {
      const column=document.querySelector('.r1-conversation').getBoundingClientRect();
      const controls=[...document.querySelectorAll('.r1-header .g-capsule,.r1-header .g-pill,.r1-drawer-button')].filter(node=>getComputedStyle(node).display!=='none').map(node=>node.getBoundingClientRect().toJSON());
      return {column:column.toJSON(),controls,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.equal(geometry.overflow,false,`viewport overflow at ${width}`);
    for(const [i,rect] of geometry.controls.entries()) {
      assert(rect.left>=geometry.column.left && rect.right<=geometry.column.right+.5,`control crosses column at ${width}/${rail}/${topics}`);
      for(const other of geometry.controls.slice(i+1)) assert(rect.right<=other.left+.5 || other.right<=rect.left+.5,`controls overlap at ${width}/${rail}/${topics}`);
    }
    layouts++;
    if(!rail && !topics && [390,1440].includes(width)) {
      await page.screenshot({path:resolve(output,`${width}-${theme}.png`)});
      await page.evaluate(()=>{document.documentElement.dataset.transparency='reduce';});
      assert.equal(await page.locator('.g-pill').evaluate(node=>getComputedStyle(node).backdropFilter),'none');
      assert(!(await page.locator('.g-pill').evaluate(node=>getComputedStyle(node).backgroundColor)).startsWith('rgba'));
      if(width===1440) {
        const tones=await page.evaluate(()=>{
          const fill=node=>{ for(let at=node; at; at=at.parentElement){ const color=getComputedStyle(at).backgroundColor; if(color!=='rgba(0, 0, 0, 0)' && color!=='transparent') return color; } return 'none'; };
          const side=document.querySelector('.r1-sidebar'), style=getComputedStyle(side);
          return {side:style.backgroundColor, blur:style.backdropFilter, conversation:fill(document.querySelector('.r1-conversation'))};
        });
        assert(!tones.side.startsWith('rgba') && !tones.side.includes('/'),`sidebar is translucent in Reduce transparency (${theme}: ${tones.side})`);
        assert.equal(tones.blur,'none',`sidebar keeps its blur in Reduce transparency (${theme})`);
        assert.notEqual(tones.side,tones.conversation,`sidebar merges into the conversation in Reduce transparency (${theme})`);
      }
      await page.screenshot({path:resolve(output,`${width}-${theme}-solid.png`)});
      await page.evaluate(()=>{document.documentElement.removeAttribute('data-transparency');});
      if(width===390) {
        await page.getByRole('button',{name:'Toggle sidebar',exact:true}).click();
        await page.waitForFunction(()=>getComputedStyle(document.querySelector('.r1-sidebar')).translate==='none');
        await page.screenshot({path:resolve(output,`${width}-${theme}-drawer.png`)});
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('.r1-frame').getAttribute('data-drawer'),'false');
        assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Toggle sidebar');
      }
    }
  }
  await page.goto(url+'?long');
  await page.waitForSelector('.edge-fade[data-bot]');
  await page.locator('.r1-scroll').evaluate(node=>{node.scrollTop=100;});
  await page.waitForSelector('.edge-fade[data-top]');
  await page.locator('.r1-scroll').evaluate(node=>{node.scrollTop=node.scrollHeight;});
  await page.waitForFunction(()=>!document.querySelector('.r1-scroll').hasAttribute('data-bot'));
  assert.deepEqual(errors,[]);
  console.log(`${layouts} responsive layouts passed; 8 theme/transparency screenshots; 2 drawer screenshots; scroll edges and drawer keyboard passed.`);
} finally {
  await browser?.close();
  if (vite) { vite.kill(); await new Promise(resolve => { if(vite.exitCode !== null) resolve(); else vite.once('exit', resolve); }); }
  await Promise.all([html,entry].map(path=>unlink(path).catch(()=>undefined)));
}
