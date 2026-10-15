// The result rules for a click. Each test fails on main: the classifier had no sub-view, frame, or typed-value check,
// so a control whose only result was one of them was reported dead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyClick, stableText } from './observe.mjs';

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

// Time-only text. A menu or dialog that only ticks a clock or an elapsed timer did nothing: the click is dead.
test('a ticking clock in an open menu is dead', () => {
  const before = { ...still, menu: 'Usage', overlay: 'Usage | Resets at 10:01 AM | Check every account now' };
  const after = { ...still, menu: 'Usage', overlay: 'Usage | Resets at 10:02 AM | Check every account now' };
  assert.deepEqual(problemsOf(before, after), ['dead']);
});

test('an elapsed timer in an open dialog is dead', () => {
  const before = { ...still, dialog: 'Running', overlay: 'Running | Elapsed 00:12 | Stop' };
  const after = { ...still, dialog: 'Running', overlay: 'Running | Elapsed 00:13 | Stop' };
  assert.deepEqual(problemsOf(before, after), ['dead']);
});

test('a relative age that only grows is dead', () => {
  const before = { ...still, menu: 'Backups', overlay: 'Backups | Last backup 5 min ago' };
  const after = { ...still, menu: 'Backups', overlay: 'Backups | Last backup 6 min ago' };
  assert.deepEqual(problemsOf(before, after), ['dead']);
});

test('a Checked at stamp that appears in an open menu is a result', () => {
  const before = { ...still, menu: 'Usage', overlay: 'Usage | Check every account now' };
  const after = { ...still, menu: 'Usage', overlay: 'Usage | Check every account now | Checked at 10:01 AM' };
  assert.deepEqual(problemsOf(before, after), []);
});

test('stableText removes clocks and elapsed times and keeps words and counts', () => {
  assert.equal(stableText('Resets at 10:01 AM, used 95%'), 'Resets at , used 95%');
  assert.equal(stableText('Elapsed 00:12 of 3 steps'), 'Elapsed of 3 steps');
  assert.equal(stableText('Checked at 9:24'), 'Checked at');
});

// A disclosure (LaterRows and similar) is a control whose aria-expanded flips when it opens its content.
test('a disclosure whose aria-expanded flips is a result, even when nothing else on the screen changes', () => {
  const before = { ...still, control: '|||false', controlled: 'hidden' };
  const after = { ...still, control: '|||true', controlled: 'shown:6 more rows' };
  assert.deepEqual(problemsOf(before, after), []);
  // The same flip with no content it controls still counts: the control's own state changed.
  assert.deepEqual(problemsOf({ ...still, control: '|||false' }, { ...still, control: '|||true' }), []);
});

test('the content a disclosure controls showing or hiding is a result', () => {
  assert.deepEqual(problemsOf({ ...still, controlled: 'hidden' }, { ...still, controlled: 'shown:Writing rows' }), []);
});

test('a button whose aria-expanded does not change, and nothing else changes, is still dead', () => {
  assert.deepEqual(problemsOf({ ...still, control: '|||false', controlled: 'hidden' }, { ...still, control: '|||false', controlled: 'hidden' }), ['dead']);
  assert.deepEqual(problemsOf({ ...still, control: '|||', controlled: '' }, { ...still, control: '|||', controlled: '' }), ['dead']);
});
