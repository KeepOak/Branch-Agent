// Captures mobile-8 (the Approvals button, the count beside Chats, and the test approval) in headless Chrome at iPhone size (393x852 pt, 3x) over the DevTools
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
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bm8-'));
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
    await evaluate(q(testId) + '.scrollIntoView({ block: "center" })'); await sleep(150);
    const box = await evaluate('(() => { const r = ' + q(testId) + '.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()');
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  };
  const proof = (call) => evaluate('globalThis.branchProof.' + call);
  const typeSlowly = async (text) => { for (const word of text.split(/(?<= )/)) { await send('Input.insertText', { text: word }); await sleep(60); } };
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true });
  const top = async () => { await evaluate('window.scrollTo(0, 0); document.querySelectorAll("*").forEach((n) => { if (n.scrollTop) n.scrollTop = 0; })'); await sleep(250); };
  const into = async (testId, block = 'center') => { await evaluate(q(testId) + '.scrollIntoView({ block: "' + block + '" })'); await sleep(300); };
  for (const scheme of ['light', 'dark']) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await send('Page.navigate', { url });
    await waitFor('approvals-button'); await waitFor('chat-agent:main:main'); await sleep(600);
    if (scheme === 'light') { recording = true; await send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 }); }
    await shot('00-chats-approvals-button-' + scheme);
    await click('chats-count'); await sleep(400);
    await shot('01-count-opens-unread-' + scheme);
    await click('filter-all'); await sleep(200);
    await click('approvals-button'); await waitFor('approvals-empty'); await waitFor('test-approval-card'); await sleep(400);
    await shot('02-approvals-nothing-waiting-' + scheme);
    await click('test-approval-send'); await waitFor('approval-plugin:request-1'); await top(); await sleep(300);
    await shot('03-test-approval-arrived-' + scheme);
    const first = 'plugin:request-1';
    await click('allow-' + first); await waitFor('answered-' + first); await top(); await sleep(300);
    await shot('04-allowed-on-this-phone-' + scheme);
    await click('test-approval-send'); const second = 'plugin:request-2'; await waitFor('approval-' + second);
    await proof('answerOnComputer("' + second + '", "deny")'); await waitFor('answered-' + second); await top(); await sleep(300);
    await shot('05-answered-on-the-computer-' + scheme);
    await click('test-approval-later'); await waitFor('test-approval-countdown'); await into('test-approval-card'); await sleep(1200);
    await shot('06-countdown-lock-the-phone-' + scheme);
    await click('test-approval-cancel'); await waitFor('test-approval-countdown', true);
    await click('approvals-back'); await waitFor('chats-screen'); await proof('request()'); await waitFor('approvals-button-count'); await sleep(400);
    await shot('07-chats-one-waiting-' + scheme);
    await click('chats-count'); await waitFor('approval-exec-live'); await sleep(400);
    await shot('08-count-opens-approvals-' + scheme);
    await proof('closeWindow()'); await click('test-approval-send'); await waitFor('test-approval-failed'); await into('test-approval-card'); await sleep(300);
    await shot('09-no-window-on-the-computer-' + scheme);
    console.log(scheme, 'asked', JSON.stringify(await proof('asked()')));
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