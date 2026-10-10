import assert from 'node:assert/strict'; import test from 'node:test'; import { createRequire } from 'node:module';
if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error('Compile the exact desktop source before testing');
const { placeWindow, fitOnScreen, keepWindowsOnScreen } = createRequire(import.meta.url)(process.env.BRANCH_DESKTOP_TEST_DIST + '/window-state.js');
const d1 = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const d2 = { bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } };
test('first launch opens maximized', () => assert.deepEqual(placeWindow(undefined, [d1]), { maximized: true }));
test('restores normal bounds on the saved display', () => assert.deepEqual(placeWindow({ mode: 'normal', x: 2000, y: 50, width: 1200, height: 800, display: d2.bounds }, [d1, d2]), { maximized: false, bounds: { x: 2000, y: 50, width: 1200, height: 800 } }));
test('restores maximized on the saved display', () => assert.equal(placeWindow({ mode: 'maximized', x: 2000, y: 50, width: 1200, height: 800, display: d2.bounds }, [d1, d2]).maximized, true));
test('saved display gone falls back to maximized', () => assert.deepEqual(placeWindow({ mode: 'normal', x: 2000, y: 50, width: 1200, height: 800, display: d2.bounds }, [d1]), { maximized: true }));
test('clamps bounds onto the work area', () => assert.deepEqual(placeWindow({ mode: 'normal', x: 1800, y: 900, width: 3000, height: 500, display: d1.bounds }, [d1]).bounds, { x: 0, y: 540, width: 1920, height: 500 }));

// WIN1: a window that runs past the screen edge comes back inside the visible screen, at launch and after display changes.
const laptop = { bounds: { x: 0, y: 0, width: 1512, height: 982 }, workArea: { x: 0, y: 38, width: 1512, height: 944 } };
test('fitOnScreen leaves a window that already fits alone', () => assert.equal(fitOnScreen({ x: 100, y: 100, width: 1200, height: 800 }, [laptop]), undefined));
test('fitOnScreen pulls a window past the right edge back inside', () => assert.deepEqual(fitOnScreen({ x: 600, y: 100, width: 1200, height: 800 }, [laptop]), { x: 312, y: 100, width: 1200, height: 800 }));
test('fitOnScreen shrinks a window wider and taller than the work area', () => assert.deepEqual(fitOnScreen({ x: 0, y: 38, width: 1920, height: 1080 }, [laptop]), { x: 0, y: 38, width: 1512, height: 944 }));
test('fitOnScreen keeps the window on the display it mostly covers', () => assert.deepEqual(fitOnScreen({ x: 3800, y: 100, width: 1200, height: 800 }, [d1, d2]), { x: 3280, y: 100, width: 1200, height: 800 }));
test('fitOnScreen brings a window on an unplugged display onto the nearest one', () => assert.deepEqual(fitOnScreen({ x: 2000, y: 50, width: 1200, height: 800 }, [d1]), { x: 720, y: 50, width: 1200, height: 800 }));

function fakeScreen(displays) {
  const handlers = {};
  return { displays, getAllDisplays: () => displays, on: (e, fn) => { (handlers[e] ??= []).push(fn); }, removeListener: (e, fn) => { handlers[e] = (handlers[e] ?? []).filter((h) => h !== fn); }, emit: (e) => (handlers[e] ?? []).forEach((fn) => fn()), handlers };
}
function fakeWindow(bounds, flags = {}) {
  const w = { bounds, set: [], isDestroyed: () => false, isMinimized: () => !!flags.minimized, isMaximized: () => !!flags.maximized, isFullScreen: () => !!flags.fullScreen, getBounds: () => w.bounds, setBounds: (b) => { w.set.push(b); w.bounds = b; } };
  return w;
}
const now = (fn) => fn();
test('keepWindowsOnScreen fits windows when the displays change', () => {
  const s = fakeScreen([d1]);
  const w = fakeWindow({ x: 1000, y: 100, width: 1200, height: 800 });
  keepWindowsOnScreen(s, () => [w], now);
  for (const e of ['display-added', 'display-removed', 'display-metrics-changed']) assert.equal(s.handlers[e]?.length, 1, e);
  assert.deepEqual(w.set, []);
  s.displays.splice(0, 1, laptop);
  s.emit('display-metrics-changed');
  assert.deepEqual(w.bounds, { x: 312, y: 100, width: 1200, height: 800 });
});
test('keepWindowsOnScreen leaves full-screen, maximized and minimized windows to the system', () => {
  const s = fakeScreen([laptop]);
  const ws = [fakeWindow({ x: 600, y: 100, width: 1200, height: 800 }, { fullScreen: true }), fakeWindow({ x: 600, y: 100, width: 1200, height: 800 }, { maximized: true }), fakeWindow({ x: 600, y: 100, width: 1200, height: 800 }, { minimized: true })];
  const fit = keepWindowsOnScreen(s, () => ws, now);
  fit();
  assert.deepEqual(ws.map((w) => w.set.length), [0, 0, 0]);
});
test('keepWindowsOnScreen returns a fit that runs at launch and a stop that removes its listeners', () => {
  const s = fakeScreen([laptop]);
  const w = fakeWindow({ x: 600, y: 100, width: 1200, height: 800 });
  const fit = keepWindowsOnScreen(s, () => [w], now);
  fit();
  assert.deepEqual(w.bounds, { x: 312, y: 100, width: 1200, height: 800 });
  fit.stop();
  assert.equal(s.handlers['display-metrics-changed'].length, 0);
});
