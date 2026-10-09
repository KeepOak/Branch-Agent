// Captures the mobile-4 Chat screen in headless Chrome at iPhone size (393x852 pt, 3x) over the DevTools
// protocol, serving the web export itself on a free loopback port, and records the light run as a screencast.
// Usage: node capture.cjs <chrome> <export dir> <out dir>
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
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bm4-'));
  chrome = spawn(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let ws;
  for (let i = 0; i < 50 && !ws; i++) {
    try { ws = (await (await fetch('http://127.0.0.1:' + port + '/json/list')).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {}
    if (!ws) await sleep(200);
  }
  const sock = new WebSocket(ws);
  await new Promise((r) => (sock.onopen = r));
  let id = 0; const pending = new Map(); const frames = []; let recording = false;
  sock.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Page.screencastFrame') {
      if (recording) frames.push({ t: Date.now(), data: m.params.data });
      send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
    }
  };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); sock.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(outDir, name + '.png'), Buffer.from(r.result.data, 'base64')); };
  const q = (testId) => 'document.querySelector(\'[data-testid="' + testId + '"]\')';
  const has = (testId) => evaluate('!!' + q(testId));
  const waitFor = async (testId, gone = false) => { for (let i = 0; i < 80; i++) { if ((await has(testId)) !== gone) return; await sleep(50); } throw new Error((gone ? 'still ' : 'missing ') + testId); };
  const click = async (testId) => {
    await waitFor(testId);
    const box = await evaluate('(() => { const r = ' + q(testId) + '.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()');
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  };
  const proof = (call) => evaluate('globalThis.branchProof.' + call);
  const typeSlowly = async (text) => { for (const word of text.split(/(?<= )/)) { await send('Input.insertText', { text: word }); await sleep(60); } };
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
  for (const scheme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await send('Page.navigate', { url });
    await waitFor('chat-agent:main:main'); await sleep(500);
    if (scheme === 'light') { recording = true; await send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 }); }
    await shot('00-chats-' + scheme);
    await click('chat-agent:main:main'); await waitFor('chat-messages'); await sleep(400);
    await shot('01-chat-' + scheme);
    await click('work-h:1:work'); await waitFor('steps-h:1:work'); await sleep(300);
    await shot('02-steps-open-' + scheme);
    await click('work-h:1:work'); await waitFor('steps-h:1:work', true);
    await click('composer'); await typeSlowly('What’s on my calendar tomorrow?'); await sleep(200);
    await shot('03-typing-' + scheme);
    await click('send'); await waitFor('live-reply'); await sleep(150);
    await shot('04-thinking-' + scheme);
    await proof('phase("starting_model")'); await sleep(500);
    for (const part of ['Tomorrow you have ', 'two things: ', 'the dentist at 9:30, ', 'and lunch with Sam ', 'at 1 at Café Lisboa.']) { await proof('delta(' + JSON.stringify(part) + ')'); await sleep(260); }
    await shot('05-streaming-' + scheme);
    await proof('finish("Tomorrow you have two things: the dentist at 9:30, and lunch with Sam at 1 at Café Lisboa.")');
    await waitFor('live-reply', true); await waitFor('send'); await sleep(300);
    await shot('06-reply-saved-' + scheme);
    await click('composer'); await typeSlowly('Write me a long poem about Lisbon'); await click('send'); await waitFor('stop-reply');
    for (const part of ['On seven hills ', 'the trams climb slow, ']) { await proof('delta(' + JSON.stringify(part) + ')'); await sleep(260); }
    await shot('07-stop-button-' + scheme);
    await click('stop-reply'); await sleep(200);
    await proof('aborted("On seven hills the trams climb slow,")');
    await waitFor('reply-ended'); await waitFor('send'); await sleep(300);
    await shot('08-stopped-' + scheme);
    await proof('drop()'); await waitFor('chat-status'); await sleep(150);
    await shot('09-reconnecting-' + scheme);
    await sleep(1800);
    await click('chat-back'); await waitFor('chats-screen'); await sleep(400);
    await shot('10-back-to-chats-' + scheme);
    if (scheme === 'light') {
      await send('Page.stopScreencast'); recording = false;
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
  .finally(() => { chrome?.kill(); server.close(); setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(); }, 1500); });
