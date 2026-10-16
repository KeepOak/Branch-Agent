import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readScreens, loadScreens } from './manifest.mjs';
import { previewScreenPatch, previewState } from './preview.mjs';

test('screens loader accepts the committed tour and rejects unasserted clicks', async () => {
  const screens = await readScreens(new URL('./screens.json', import.meta.url));
  assert.ok(screens.length >= 15);
  assert.ok(screens.some((screen) => screen.id === 'pixel-office'));
  for (const id of ['canopy-now', 'inbox', 'customize-tools-skills', 'people', 'automations-board', 'row-menu', 'pane-memory', 'computer-stage', 'browser-stage']) {
    assert.ok(screens.some((screen) => screen.id === id), `missing ${id}`);
  }
  assert.equal(screens.at(-1).id, 'browser-stage');
  // The tour matches text exactly, so the blank-browser assertion must be copy the view still renders.
  const browserCopy = await readFile(new URL('../../window/src/stage/BrowserView.tsx', import.meta.url), 'utf8');
  const browserAssert = screens.at(-1).steps.at(-1);
  assert.equal(browserAssert.action, 'assert');
  assert.ok(browserCopy.includes(`"${browserAssert.target}"`), `BrowserView.tsx does not render "${browserAssert.target}"`);
  const rowMenu = screens.find((screen) => screen.id === 'row-menu');
  assert.ok(rowMenu.steps.some((step) => step.action === 'contextmenu'));
  assert.match(rowMenu.steps[0].target, /Research notes/);
  assert.equal(rowMenu.steps[0].expectBy, 'testid');
  assert.equal(rowMenu.steps[0].expect, 'menu-own-window');
  assert.throws(() => loadScreens('[{"id":"a","steps":[{"action":"click","by":"css","target":"button"}]}]'), /response assertion/);
  assert.throws(() => loadScreens('[{"id":"a","steps":[{"action":"contextmenu","by":"css","target":".row"}]}]'), /response assertion/);
  assert.throws(() => loadScreens('[{"id":"a","steps":[{"action":"assert","by":"css","target":"body"}]},{"id":"a","steps":[{"action":"assert","by":"css","target":"body"}]}]'), /duplicate/);
  assert.deepEqual(previewState('canopy-now'), { kind: 'place', view: 'canopy', tabs: { canopy: 'now' } });
  assert.deepEqual(previewState('inbox'), { kind: 'place', view: 'inbox', tabs: { inbox: 'needs' } });
  assert.equal(previewState('customize-tools-skills').tools9.k, 'skills');
  assert.equal(previewState('people').view, 'team');
  assert.equal(previewState('automations-board').tabs.automations, 'board');
  const board = screens.find((screen) => screen.id === 'automations-board');
  assert.equal(board.steps[0].target, '.au-more-tab', 'Board sits under More, so More opens first');
  assert.equal(board.steps[0].expect, '[data-testid="au-more-menu"]');
  const boardStep = board.steps.at(-1);
  assert.equal(boardStep.target, 'Board');
  assert.equal(boardStep.expectBy, 'css');
  assert.equal(boardStep.expect, '.au-board');
  assert.equal(previewState('computer-stage').stage, 'computer');
  assert.equal(previewState('browser-stage').stage, 'browser');
  assert.equal(previewState('pane-memory').pane, 'memory');
  assert.equal(previewState('row-menu').kind, 'row-menu');
  assert.deepEqual(previewScreenPatch(previewState('canopy-now')), { view: 'canopy', tabs: { canopy: 'now' } });
});
