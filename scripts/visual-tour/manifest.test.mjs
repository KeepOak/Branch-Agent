import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readScreens, loadScreens } from './manifest.mjs';

test('screens loader accepts the committed tour and rejects unasserted clicks', async () => {
  const screens = await readScreens(new URL('./screens.json', import.meta.url));
  assert.ok(screens.length >= 15);
  assert.ok(screens.some((screen) => screen.id === 'pixel-office'));
  assert.throws(() => loadScreens('[{"id":"a","steps":[{"action":"click","by":"css","target":"button"}]}]'), /response assertion/);
  assert.throws(() => loadScreens('[{"id":"a","steps":[{"action":"assert","by":"css","target":"body"}]},{"id":"a","steps":[{"action":"assert","by":"css","target":"body"}]}]'), /duplicate/);
});
