import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkedStep } from './dead-click.mjs';

const locate = (_page, _by, target) => ({ first: () => ({
  isVisible: async () => true, isEnabled: async () => true, click: async () => {},
  waitFor: async () => { if (target === 'never') throw new Error('timeout'); },
}), count: async () => 1 });

test('dead-click detector fails when an enabled click has no visible response', async () => {
  await assert.rejects(checkedStep({}, { action: 'click', by: 'css', target: 'button', expectBy: 'css', expect: 'never' }, locate), /Dead click/);
  await checkedStep({}, { action: 'click', by: 'css', target: 'button', expectBy: 'css', expect: 'dialog' }, locate);
  await assert.rejects(checkedStep({}, { action: 'drag', by: 'css', target: 'source', toBy: 'css', to: 'target', expectBy: 'css', expect: 'dialog' }, locate), /already visible/);
});
