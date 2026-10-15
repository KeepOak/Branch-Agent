// Isolated production-component proof. The requests below are fixtures for the screenshot, never product data.
// Run from window/: CHROMIUM_EXECUTABLE=<browser> node src/screens/approvals/approvals.layout.mjs <output>
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../../..', import.meta.url));
const output = resolve(process.argv[2] ?? `${tmpdir()}/r1-approvals-proof`);
const html = resolve(root, '.r1-approvals-proof.html'), entry = resolve(root, '.r1-approvals-proof.tsx');
const socket = createServer();
await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
let vite, browser;
try {
  await mkdir(output, { recursive: true });
  await writeFile(html, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/.r1-approvals-proof.tsx"></script></body></html>', { flag: 'wx' });
  await writeFile(entry, `import {createRoot} from 'react-dom/client';
import './src/theme/tokens.css'; import './src/theme/base.css'; import './src/screens/frame/frame.css';
import {CapabilityProvider} from './src/connect/capabilities';
import {ApprovalsLayer, AskCard, readAsk} from './src/screens/approvals';
const view = new URLSearchParams(location.search).get('view') === 'other' ? 'other' : 'chat';
const listeners = new Set();
const methods = ['exec.approval.list','exec.approval.resolve','plugin.approval.list','plugin.approval.resolve','question.list','question.resolve','agents.list','config.get','config.patch'];
const engine = {features:{methods,events:[]}, request:async(m)=>m==='config.get'?{config:{security:{lockdown:view==='chat'}},hash:'fixture',valid:true}:m==='agents.list'?{agents:[{id:'ledger',identity:{name:'Ledger'}},{id:'scout',identity:{name:'Scout'}}]}:m.endsWith('.list')?[]:{}, onEvent:(fn)=>{listeners.add(fn);return()=>listeners.delete(fn);}, sessionKey:'agent:main:main', scopes:['operator.admin']};
const mail = readAsk('plugin', {id:'p0', request:{title:'Send this email to Dana Okafor?', description:'To: Dana Okafor\\nSubject: Thursday’s delivery\\nAttached: quote.pdf\\nHi Dana, the quote is attached. Thursday works for us.', allowedDecisions:['allow-once','allow-always','deny']}});
const sent = readAsk('plugin', {id:'p9', request:{title:'Send the invoice to Oakfield?', description:'To: Oakfield', allowedDecisions:['allow-once','deny']}});
document.body.style.background = 'linear-gradient(135deg, #f0c27b 0%, #d4775a 35%, #4b6cb7 70%, #182848 100%) fixed';
createRoot(document.getElementById('root')).render(<CapabilityProvider engine={engine}><div className="r1-conversation" style={{position:'relative',height:'100vh',overflow:'hidden'}}>
  <div style={{paddingTop:'calc(var(--hdr) + 200px)',display:'flex',flexDirection:'column',gap:12,alignItems:'center',paddingInline:16}}>
    <AskCard state={{ask:mail,status:'waiting'}} name="Ledger" onAnswer={()=>undefined} scopes={['operator.admin']}/>
    <div style={{width:'min(100%,560px)'}}><AskCard state={{ask:sent,status:'settled',settled:'allow-once'}} name="Ledger" onAnswer={()=>undefined}/></div>
  </div>
  <ApprovalsLayer engine={engine} sessionKey="agent:main:main" view={view} onOpen={()=>undefined}/>
</div></CapabilityProvider>);
setTimeout(()=>{
  const emit=(event,payload)=>listeners.forEach(fn=>fn({event,payload}));
  emit('plugin.approval.requested',{id:'p1',request:{title:'Send this email to Dana Okafor?',description:'To: Dana Okafor',agentId:'ledger',sessionKey:'agent:ledger:main',allowedDecisions:['allow-once','deny']}});
  emit('exec.approval.requested',{id:'e1',request:{command:'npm publish',agentId:'scout',sessionKey:'agent:scout:main'}});
  emit('plugin.approval.requested',{id:'p2',request:{title:'Sign in to your bank?',description:'Site: bank.example',agentId:'scout',sessionKey:'agent:scout:main',allowedDecisions:['allow-once','deny']}});
}, 300);`, { flag: 'wx' });
  vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', windowsHide: true });
  const base = `http://127.0.0.1:${port}/.r1-approvals-proof.html`;
  for (let tries = 0; ; tries++) {
    try { if ((await fetch(base)).ok) break; } catch { /* Wait only for this scratch server. */ }
    if (tries > 150) throw new Error('Scratch Vite did not start');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let layouts = 0;
  for (const view of ['chat', 'other']) for (const theme of ['light', 'dark']) for (const width of [390,768,1024,1180,1280,1366,1440,1600,1920,2560]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`${base}?view=${view}`);
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await page.locator(view === 'chat' ? '[data-testid=r1-drop]' : '[data-testid=r1-banner]').first().waitFor();
    await page.waitForTimeout(700);
    const geometry = await page.evaluate(() => {
      const box = n => n.getBoundingClientRect().toJSON();
      const groups = [...document.querySelectorAll('.r1-ask, .r1-drop, .r1-banner, .r1-lock')].map(region => ({ region: box(region), controls: [...region.querySelectorAll('button, input')].filter(n => n.offsetParent && getComputedStyle(n).opacity !== '0').map(box) }));
      return { groups, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(geometry.overflow, false, `viewport overflow at ${width}`);
    for (const { region, controls } of geometry.groups) for (const [i, r] of controls.entries()) {
      assert(r.left >= region.left - .5 && r.right <= region.right + .5, `control crosses region at ${view} ${width}`);
      for (const other of controls.slice(i + 1)) assert(r.right <= other.left + .5 || other.right <= r.left + .5 || r.bottom <= other.top + .5 || other.bottom <= r.top + .5, `controls overlap at ${view} ${width}`);
    }
    layouts++;
    if ([390, 1440].includes(width)) await page.screenshot({ path: resolve(output, `r1-05-${view}-${width}-${theme}.png`) });
  }
  assert.deepEqual(errors, []);
  console.log(`${layouts} layouts passed; 8 view/theme/width screenshots.`);
} finally {
  await browser?.close();
  if (vite) { vite.kill(); await new Promise(resolve => { if (vite.exitCode !== null) resolve(); else vite.once('exit', resolve); }); }
  await Promise.all([html, entry].map(path => unlink(path).catch(() => undefined)));
}
