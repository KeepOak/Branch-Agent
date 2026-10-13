// Isolated production-component proof. Empty gateway responses are fixtures, never product data.
// Run from window/: CHROMIUM_EXECUTABLE=<browser> node src/screens/chatapps/wizard.layout.mjs <output>
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const output = resolve(process.argv[2] ?? `${tmpdir()}/r1-chatapps-wizard-proof`);
const html = resolve(root, '.r1-chatapps-wizard-proof.html'), entry = resolve(root, '.r1-chatapps-wizard-proof.tsx');
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
let vite, browser;
try {
  await mkdir(output, { recursive: true });
  await writeFile(html, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.r1-chatapps-wizard-proof.tsx"></script></body></html>', { flag: 'wx' });
  await writeFile(entry, `import {createRoot} from 'react-dom/client';
import './src/theme/tokens.css'; import './src/theme/base.css';
import {ChatAppsPage} from './src/screens/chatapps/ChatAppsPage';
const engine={scopes:['operator.admin'],features:{methods:['channels.status','channels.pairing.list','channels.pairing.approve','config.patch','wizard.start','wizard.next','wizard.cancel'],events:[]}, request:async(m)=>m==='wizard.start'?{sessionId:'fixture',done:false,step:{id:'token',type:'text',sensitive:true,title:'Bot token',message:'Paste the token from BotFather.'}}:m==='wizard.next'?{done:true,status:'done'}:m==='channels.status'?{}:m==='channels.pairing.list'?{accounts:[],requests:[],limits:{ttlMs:3600000,pendingPerAccount:3}}:m==='config.get'?{config:{},hash:'fixture',valid:true}:m==='agents.list'?{agents:[],defaultId:''}:{},onEvent:()=>()=>{},sessionKey:null};
createRoot(document.getElementById('root')!).render(<ChatAppsPage engine={engine}/>);`, { flag: 'wx' });
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', windowsHide: true });
  const url = `http://127.0.0.1:${port}/.r1-chatapps-wizard-proof.html`;
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(url)).ok) break; } catch { /* Wait only for this scratch server. */ }
    if (tries > 100) throw new Error('Scratch Vite did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let layouts = 0;
  for (const theme of ['light', 'dark']) for (const width of [390,768,1024,1180,1280,1366,1440,1600,1920,2560]) {
    await page.setViewportSize({width,height:width===390?844:1000});
    await page.goto(url);
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
    await page.getByText('No one is waiting.',{exact:true}).waitFor();
    await page.getByRole('button',{name:/Telegram.*Set up/}).click();
    await page.getByRole('dialog',{name:'Set up Telegram'}).waitFor();
    const geometry = await page.evaluate(() => {
      const region=document.querySelector('.r1-cw .dlg').getBoundingClientRect().toJSON();
      const controls=[...document.querySelectorAll('.r1-cw button,.r1-cw a,.r1-cw input')].map(n=>n.getBoundingClientRect().toJSON());
      return {region,controls,overflow:document.documentElement.scrollWidth>innerWidth};
    });
    assert.equal(geometry.overflow,false,`viewport overflow at ${width}`);
    for (const [i,r] of geometry.controls.entries()) {
      assert(r.left>=geometry.region.left-.5 && r.right<=geometry.region.right+.5,`control crosses region at ${width}`);
      for (const other of geometry.controls.slice(i+1)) assert(r.right<=other.left+.5||other.right<=r.left+.5||r.bottom<=other.top+.5||other.bottom<=r.top+.5,`controls overlap at ${width}`);
    }
    layouts++;
    if ([390,1440].includes(width)) await page.screenshot({path:resolve(output,`${width}-${theme}-create.png`)});
    await page.getByRole('button',{name:'I have the details'}).click();
    const token=page.getByLabel('Bot token',{exact:true});
    await token.waitFor();
    await token.fill('invalid');
    assert.equal(await page.getByRole('button',{name:'Continue',exact:true}).isDisabled(),true);
    if ([390,1440].includes(width)) await page.screenshot({path:resolve(output,`${width}-${theme}-paste.png`)});
    await token.fill('123456:'+'a'.repeat(32));
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByRole('button',{name:'Continue to Save'}).click();
    await page.getByText('Telegram setup is saved by the engine.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Done',exact:true}).click();
  }
  await page.getByRole('searchbox',{name:'Search chat apps'}).fill('slack');
  assert.equal(await page.locator('.r1-ca-card').count(),1);
  assert.deepEqual(errors,[]);
  console.log(`${layouts} layouts passed; 8 theme/width screenshots; token validation, engine completion and catalogue search passed.`);
} finally {
  await browser?.close();
  if(vite) { vite.kill(); await new Promise(resolve=>{if(vite.exitCode!==null)resolve();else vite.once('exit',resolve);}); }
  await Promise.all([html,entry].map(path=>unlink(path).catch(()=>undefined)));
}
