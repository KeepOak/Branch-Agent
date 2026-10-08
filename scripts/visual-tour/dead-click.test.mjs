import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkedStep, pendingEntranceAnimations } from './dead-click.mjs';

const clicks = [];
const locate = (_page, _by, target) => ({ first: () => ({
  isVisible: async () => true, isEnabled: async () => true,
  click: async (opts) => { clicks.push({ target, opts }); },
  waitFor: async () => { if (target === 'never') throw new Error('timeout'); },
}), count: async () => 1 });

test('dead-click detector fails when an enabled click has no visible response', async () => {
  clicks.length = 0;
  await assert.rejects(checkedStep({}, { action: 'click', by: 'css', target: 'button', expectBy: 'css', expect: 'never' }, locate), /Dead click/);
  await checkedStep({}, { action: 'click', by: 'css', target: 'button', expectBy: 'css', expect: 'dialog' }, locate);
  await assert.rejects(checkedStep({}, { action: 'drag', by: 'css', target: 'source', toBy: 'css', to: 'target', expectBy: 'css', expect: 'dialog' }, locate), /already visible/);
  await assert.rejects(checkedStep({}, { action: 'contextmenu', by: 'css', target: '.row', expectBy: 'css', expect: 'never' }, locate), /Dead contextmenu/);
  await checkedStep({}, { action: 'contextmenu', by: 'css', target: '.row', expectBy: 'css', expect: 'dialog' }, locate);
  assert.deepEqual(clicks.at(-1), { target: '.row', opts: { button: 'right' } });
});

function readyLocator(target, hooks) {
  return {
    first: () => ({
      isVisible: async () => true,
      isEnabled: async () => true,
      click: async (opts) => { hooks.onClick?.(target, opts); },
      waitFor: async () => { await hooks.onWait?.(target); },
      evaluate: hooks.evaluate,
    }),
    count: async () => 1,
  };
}

test('dead-click detector retries one click when the expected control shows on the second try', async () => {
  const seen = [];
  let waits = 0;
  const locate = (_page, _by, target) => readyLocator(target, {
    onClick: (clicked) => { seen.push(clicked); },
    onWait: async (waited) => {
      if (waited !== 'panel') return;
      waits += 1;
      if (waits < 2) throw new Error('timeout');
    },
  });
  await checkedStep({}, { action: 'click', by: 'css', target: 'Side panel', expectBy: 'css', expect: 'panel' }, locate);
  assert.deepEqual(seen, ['Side panel', 'Side panel']);
});

test('dead-click detector does not retry when the expected control is visible the first time', async () => {
  let clicks = 0;
  const locate = () => readyLocator('Open the browser', { onClick: () => { clicks += 1; } });
  await checkedStep({}, { action: 'click', by: 'css', target: 'Open the browser', expectBy: 'css', expect: '.browser-st' }, locate);
  assert.equal(clicks, 1);
});

test('dead-click detector still fails after one retry and says the retry was attempted', async () => {
  let clicks = 0;
  const locate = (_page, _by, target) => readyLocator(target, {
    onClick: () => { clicks += 1; },
    onWait: async (waited) => { if (waited === 'never') throw new Error('timeout'); },
  });
  await assert.rejects(
    checkedStep({}, { action: 'click', by: 'css', target: 'Side panel', expectBy: 'css', expect: 'never' }, locate),
    /Dead click: Side panel did not show never \(retry attempted\)/,
  );
  assert.equal(clicks, 2);
});

test('dead-click detector says the retry was attempted when the second click does not land', async () => {
  let clicks = 0;
  const locate = (_page, _by, target) => readyLocator(target, {
    onClick: () => {
      clicks += 1;
      if (clicks > 1) throw new Error('detached');
    },
    onWait: async (waited) => { if (waited === 'never') throw new Error('timeout'); },
  });
  await assert.rejects(
    checkedStep({}, { action: 'click', by: 'css', target: 'Open the browser', expectBy: 'css', expect: 'never' }, locate),
    /Dead click: Open the browser did not show never \(retry attempted\)/,
  );
  assert.equal(clicks, 2);
});

test('dead-click detector retries a contextmenu once with the right button', async () => {
  const seen = [];
  const locate = (_page, _by, target) => readyLocator(target, {
    onClick: (_clicked, opts) => { seen.push(opts); },
    onWait: async (waited) => { if (waited === 'never') throw new Error('timeout'); },
  });
  await assert.rejects(
    checkedStep({}, { action: 'contextmenu', by: 'css', target: '.row', expectBy: 'css', expect: 'never' }, locate),
    /Dead contextmenu: \.row did not show never \(retry attempted\)/,
  );
  assert.deepEqual(seen, [{ button: 'right' }, { button: 'right', timeout: 5000 }]);
});

test('dead-click detector says the retry was not attempted when the row disappears before the second click', async () => {
  let clicks = 0;
  const locate = (_page, _by, target) => readyLocator(target, {
    onClick: () => { clicks += 1; },
    onWait: async (waited) => { if (waited === 'never') throw new Error('timeout'); },
    evaluate: async () => { if (clicks > 0) throw new Error('row gone'); },
  });
  await assert.rejects(
    checkedStep({}, { action: 'click', by: 'css', target: 'Side panel', expectBy: 'css', expect: 'never' }, locate),
    /Dead click: Side panel did not show never \(retry not attempted\)/,
  );
  assert.equal(clicks, 1);
});

test('dead-click detector waits for a finite entrance animation before clicking', async () => {
  let clicked = false;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const locate = (_page, _by, target) => readyLocator(target, {
    onClick: () => { clicked = true; },
    evaluate: (fn) => fn({
      parentElement: null,
      getAnimations: () => [{ effect: { getTiming: () => ({ iterations: 1 }) }, finished: gate }],
    }),
  });
  const pending = checkedStep({}, { action: 'click', by: 'css', target: 'button', expectBy: 'css', expect: 'dialog' }, locate);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(clicked, false);
  release();
  await pending;
  assert.equal(clicked, true);
});

test('dead-click detector does not wait on an infinite ancestor animation', async () => {
  let finiteDone = false;
  const child = {
    parentElement: {
      parentElement: null,
      getAnimations: () => [
        { effect: { getTiming: () => ({ iterations: Infinity }) }, finished: new Promise(() => {}) },
        { effect: { getTiming: () => ({ iterations: 1 }) }, finished: Promise.resolve().then(() => { finiteDone = true; }) },
      ],
    },
    getAnimations: () => [],
  };
  await pendingEntranceAnimations(child);
  assert.equal(finiteDone, true);
});
