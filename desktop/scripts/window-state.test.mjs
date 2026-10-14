import assert from 'node:assert/strict'; import test from 'node:test'; import { createRequire } from 'node:module';
if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw Error('Compile the exact desktop source before testing');
const { placeWindow } = createRequire(import.meta.url)(process.env.BRANCH_DESKTOP_TEST_DIST + '/window-state.js');
const d1 = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const d2 = { bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } };
test('first launch opens maximized', () => assert.deepEqual(placeWindow(undefined, [d1]), { maximized: true }));
test('restores normal bounds on the saved display', () => assert.deepEqual(placeWindow({ mode: 'normal', x: 2000, y: 50, width: 1200, height: 800, display: d2.bounds }, [d1, d2]), { maximized: false, bounds: { x: 2000, y: 50, width: 1200, height: 800 } }));
test('restores maximized on the saved display', () => assert.equal(placeWindow({ mode: 'maximized', x: 2000, y: 50, width: 1200, height: 800, display: d2.bounds }, [d1, d2]).maximized, true));
test('saved display gone falls back to maximized', () => assert.deepEqual(placeWindow({ mode: 'normal', x: 2000, y: 50, width: 1200, height: 800, display: d2.bounds }, [d1]), { maximized: true }));
test('clamps bounds onto the work area', () => assert.deepEqual(placeWindow({ mode: 'normal', x: 1800, y: 900, width: 3000, height: 500, display: d1.bounds }, [d1]).bounds, { x: 0, y: 540, width: 1920, height: 500 }));

test('a full disk never throws out of a window-state save, shows the banner once, and clears on the next save', () => {
  const require = createRequire(import.meta.url);
  const { trackWindowState } = require(process.env.BRANCH_DESKTOP_TEST_DIST + '/window-state.js');
  const { diskIsFull, onDiskFullChange } = require(process.env.BRANCH_DESKTOP_TEST_DIST + '/disk-full.js');
  const handlers = {};
  const w = { on: (event, fn) => { handlers[event] = fn; }, isDestroyed: () => false, isMinimized: () => false, isMaximized: () => false,
    getNormalBounds: () => ({ x: 10, y: 20, width: 800, height: 600 }) };
  let failing = true; const saved = []; const seen = [];
  const stop = onDiskFullChange(full => seen.push(full));
  // ENOSPC is injected into the write; the real disk is never filled.
  trackWindowState(w, '/data', () => d1.bounds, 'window-state.json', (file, text) => {
    if (failing) throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
    saved.push([file.replace(/\\/g, '/'), JSON.parse(text).width]);
  });
  try {
    assert.doesNotThrow(() => handlers.maximize());
    assert.doesNotThrow(() => handlers.close());
    assert.equal(diskIsFull(), true);
    assert.deepEqual(seen, [true]);
    failing = false;
    handlers.unmaximize();
    assert.deepEqual(saved, [['/data/window-state.json', 800]]);
    assert.equal(diskIsFull(), false);
    assert.deepEqual(seen, [true, false]);
  } finally { stop(); }
});
