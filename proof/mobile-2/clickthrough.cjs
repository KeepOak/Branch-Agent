// Click-through of the mobile-2 pairing screens in headless Chrome at iPhone size (393x852 pt, 3x),
// driven through the DevTools protocol. Saves a still for every step and the screencast frames.
// Usage: node clickthrough.cjs <chrome.exe> <url> <out dir>
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [exe, url, outDir] = process.argv.slice(2);
const port = 47331;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bm2-'));
const chrome = spawn(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');
const validCode = b64(JSON.stringify({ url: 'ws://studio.local:19031', bootstrapToken: 'boot-1', expiresAtMs: Date.now() + 600000 }));

(async () => {
  let ws;
  for (let i = 0; i < 50 && !ws; i++) {
    try { ws = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
    if (!ws) await sleep(200);
  }
  const sock = new WebSocket(ws);
  await new Promise((r) => (sock.onopen = r));
  let id = 0; const pending = new Map(); const frames = [];
  sock.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Page.screencastFrame') {
      frames.push({ t: Date.now(), data: m.params.data });
      send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
    }
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); sock.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64')); };
  const waitFor = async (testId) => { for (let i = 0; i < 60; i++) { if (await evaluate('!!document.querySelector(\'[data-testid="' + testId + '"]\')')) return; await sleep(100); } throw new Error('missing ' + testId); };
  const click = async (testId) => {
    await waitFor(testId);
    const box = await evaluate('(() => { const r = document.querySelector(\'[data-testid="' + testId + '"]\').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()');
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  };
  const typeInto = async (testId, text) => {
    await click(testId);
    await evaluate('document.querySelector(\'[data-testid="' + testId + '"]\').select()');
    await send('Input.insertText', { text });
  };

  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });
  for (const scheme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await send('Page.navigate', { url });
    await waitFor('welcome-screen');
    await sleep(400);
    if (scheme === 'light') await send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
    await shot(`01-welcome-${scheme}`);
    await click('pair-button'); await waitFor('camera-permission'); await sleep(300); await shot(`02-camera-permission-${scheme}`);
    await click('enter-code'); await waitFor('enter-code-screen'); await sleep(300); await shot(`03-enter-code-${scheme}`);
    await typeInto('code-input', 'this is not a code'); await click('submit-code'); await waitFor('code-problem'); await sleep(200); await shot(`04-code-problem-${scheme}`);
    await typeInto('code-input', validCode); await sleep(200); await click('submit-code');
    await waitFor('pairing-approval'); await sleep(700); await shot(`05-approve-on-computer-${scheme}`);
    await sleep(1200);
    await evaluate('globalThis.branchProof.approve()');
    await waitFor('paired-screen'); await sleep(500); await shot(`06-paired-${scheme}`);
    await click('unpair'); await waitFor('confirm-unpair'); await sleep(300); await shot(`07-unpair-confirm-${scheme}`);
    await click('confirm-unpair'); await waitFor('welcome-screen'); await sleep(500); await shot(`08-back-to-welcome-${scheme}`);
    if (scheme === 'light') {
      await send('Page.stopScreencast');
      const dir = path.join(outDir, 'frames');
      fs.mkdirSync(dir, { recursive: true });
      const list = [];
      frames.forEach((f, i) => {
        const name = 'f' + String(i).padStart(4, '0') + '.jpg';
        fs.writeFileSync(path.join(dir, name), Buffer.from(f.data, 'base64'));
        const next = frames[i + 1];
        list.push("file '" + name + "'", 'duration ' + ((next ? next.t - f.t : 500) / 1000).toFixed(3));
      });
      fs.writeFileSync(path.join(dir, 'list.txt'), list.join('\n') + '\n');
      console.log('frames', frames.length);
    }
  }
  sock.close();
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => { chrome.kill(); setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }, 1500); });
