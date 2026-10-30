import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SettingsTwins, twinSkips, twinSignature } from './twins.mjs';

const names = (count, prefix = 'control') => Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`);

test('a page that clicked every control is a twin source, and a same-named page is skipped', () => {
  const twins = new SettingsTwins();
  twins.record('goto', names(5), 'settings:goto@advanced', true);
  assert.equal(twins.twinOf('goto', names(5)), 'settings:goto@advanced');
  assert.equal(twins.twinOf('goto', names(4)), undefined);
  assert.equal(twins.twinOf('models', names(5)), undefined);
});

test('a capped first page is not a twin source, so a same-named later page is still crawled', () => {
  // The 30-names case: the Technical page has 30 controls, the cap clicks 24, so 6 were never clicked.
  const twins = new SettingsTwins();
  twins.record('general', names(30), 'settings:general', false);
  assert.equal(twins.twinOf('general', names(30)), undefined);
});

test('a skipped twin lists each of its controls as the same as the twin', () => {
  const skips = twinSkips('settings:general', 'settings:general@advanced', names(3));
  assert.deepEqual(skips.map((s) => s.label), ['control 1', 'control 2', 'control 3']);
  assert.ok(skips.every((s) => s.reason === 'same-as settings:general@advanced' && s.screen === 'settings:general'));
});

test('the signature ignores name order and duplicates', () => {
  assert.equal(twinSignature('p', ['b', 'a', 'a']), twinSignature('p', ['a', 'b']));
  assert.notEqual(twinSignature('p', ['a']), twinSignature('q', ['a']));
});
