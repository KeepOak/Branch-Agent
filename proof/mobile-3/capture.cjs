// Captures the mobile-3 Chats screens in headless Chrome at iPhone size (393x852 pt, 3x) over the DevTools
// protocol, serving the web export itself on a free loopback port. Usage: node capture.cjs <chrome> <export dir> <out dir>
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const [exe, root, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
  res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
let chrome; let profile;

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const port = 47000 + Math.floor(Math.random() * 900);
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bm3-'));
  chrome = spawn(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 50 && !ws; i++) {
    try { ws = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
    if (!ws) await sleep(200);
  }
  const sock = new WebSocket(ws);
  await new Promise((r) => (sock.onopen = r));
  let id = 0; const pending = new Map();
  sock.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); sock.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64')); };
  const has = (testId) => evaluate('!!document.querySelector(\'[data-testid="' + testId + '"]\')');
  const waitFor = async (testId, gone = false) => { for (let i = 0; i < 80; i++) { if ((await has(testId)) !== gone) return; await sleep(50); } throw new Error((gone ? 'still ' : 'missing ') + testId); };
  const click = async (testId) => {
    await waitFor(testId);
    const box = await evaluate('(() => { const r = document.querySelector(\'[data-testid="' + testId + '"]\').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()');
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  };
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
  for (const scheme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await send('Page.navigate', { url });
    await waitFor('chat-agent:main:main'); await sleep(500);
    await shot('01-chats-' + scheme);
    await click('filter-rooms'); await waitFor('chat-agent:oak:room:launch'); await sleep(300);
    await shot('02-rooms-chip-' + scheme);
    await click('filter-snoozed'); await waitFor('chat-agent:researcher:taxes'); await sleep(300);
    await shot('03-snoozed-chip-' + scheme);
    await click('filter-all'); await waitFor('chat-agent:main:main');
    await click('chat-search'); await send('Input.insertText', { text: 'tests' });
    await waitFor('section-Messages'); await sleep(300);
    await shot('04-search-chats-and-messages-' + scheme);
    await evaluate('(() => { const el = document.querySelector(\'[data-testid="chat-search"]\'); el.select(); })()');
    await send('Input.insertText', { text: 'zebra' }); await waitFor('chats-no-match'); await sleep(300);
    await shot('05-no-match-' + scheme);
    await evaluate('(() => { const el = document.querySelector(\'[data-testid="chat-search"]\'); el.select(); })()');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await waitFor('chat-agent:main:main');
    await evaluate('globalThis.branchProof.addChat()');
    await waitFor('chat-agent:oak:launch'); await sleep(300);
    await shot('06-new-chat-live-' + scheme);
    await evaluate('globalThis.branchProof.drop()');
    await waitFor('chats-offline'); await sleep(100);
    await shot('07-reconnecting-' + scheme);
    await waitFor('chats-offline', true); await sleep(200);
    await click('computer-button'); await waitFor('paired-screen'); await sleep(300);
    await shot('08-your-computer-' + scheme);
    await click('back-to-chats'); await waitFor('chats-screen'); await sleep(300);
    await shot('09-back-to-chats-' + scheme);
  }
  sock.close();
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => { chrome?.kill(); server.close(); setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }, 1500); });
