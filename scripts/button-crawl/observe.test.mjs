// The result rules for a click. Each test fails on main: the classifier had no sub-view, frame, or typed-value check,
// so a control whose only result was one of them was reported dead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyClick } from './observe.mjs';

const still = {
  route: 'settings:devices', dialog: null, menu: null, panel: null, toast: null, mainText: 'Devices', viewText: 'v1',
  control: '', focus: '', hash: '', chrome: '', historyMoves: 0, popups: 0, downloads: 0, configRevision: 'h1',
  overlay: '', values: 'f1', frame: '|||', requests: [], requestCount: 0, alert: '', blank: false, unimplemented: false,
};
const problemsOf = (before, after) => classifyClick({ before, after, elapsedMs: 10 }).problems;

test('a sub-view that swaps inside a menu that stays open is a result', () => {
  const before = { ...still, menu: 'Attach', overlay: 'Files | Add from' };
  const after = { ...still, menu: 'Attach', overlay: 'Add from | Pick a source' };
  assert.deepEqual(problemsOf(before, after), []);
});

test('a menu that closes is not a result by itself', () => {
  const before = { ...still, menu: 'Attach', overlay: 'Files | Add from' };
  const after = { ...still, menu: null, overlay: '' };
  assert.deepEqual(problemsOf(before, after), ['dead']);
});

test('collapsing the R1 sidebar is a result', () => {
  const before = { ...still, frame: 'true||false|false' };
  const after = { ...still, frame: 'false||false|false' };
  assert.deepEqual(problemsOf(before, after), []);
});

test('a typed or filled field is a result', () => {
  const before = { ...still, values: 'name=' };
  const after = { ...still, values: 'name=Researcher 2' };
  assert.deepEqual(problemsOf(before, after), []);
});

test('nothing changing is still dead', () => {
  assert.deepEqual(problemsOf(still, still), ['dead']);
});
