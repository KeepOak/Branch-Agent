import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PageCoverage, neverKey } from './coverage.mjs';

const els = (names) => names.map((name) => ({ name }));
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `control ${from + i}`);

/** Runs one level the way the crawl does: plan, then click each chosen control. */
function runLevel(coverage, page, names, cap) {
  const plan = coverage.plan(page, els(names), cap);
  for (const el of plan.chosen) coverage.markClicked(page, el.name);
  return plan;
}

test('a page with 60 controls across levels means all 60 get clicked within the caps', () => {
  const coverage = new PageCoverage();
  // Technical shows all 60, capped at 40; Advanced shows the 20 Technical could not reach plus some already clicked.
  const technical = runLevel(coverage, 'permissions', range(1, 60), 40);
  assert.equal(technical.chosen.length, 40);
  assert.equal(technical.beyond.length, 20);
  const advanced = runLevel(coverage, 'permissions', [...range(41, 60), ...range(1, 10)], 24);
  assert.equal(advanced.chosen.length, 20, 'only the 20 nobody clicked yet are clicked at Advanced');
  const regular = runLevel(coverage, 'permissions', range(1, 30), 24);
  assert.equal(regular.chosen.length, 0, 'Regular adds nothing new');
  assert.deepEqual(coverage.neverClicked(), []);
});

test('a control seen at no level that clicked it is never clicked, and the gate can name it', () => {
  const coverage = new PageCoverage();
  runLevel(coverage, 'devices', range(1, 45), 40);
  assert.deepEqual(coverage.neverClicked(), [{ page: 'devices', name: 'control 41' }, { page: 'devices', name: 'control 42' }, { page: 'devices', name: 'control 43' }, { page: 'devices', name: 'control 44' }, { page: 'devices', name: 'control 45' }]);
  assert.equal(neverKey('devices', 'control 41'), 'settings:devices :: control 41');
});

test('a cap that leaves names beyond the room reports them, and the room goes to unclicked names first', () => {
  const coverage = new PageCoverage();
  runLevel(coverage, 'chatapps', range(1, 3), 3);
  const plan = coverage.plan('chatapps', els(['control 1', 'control 4', 'control 5']), 1);
  assert.deepEqual(plan.chosen.map((el) => el.name), ['control 4']);
  assert.deepEqual(plan.beyond, ['control 5']);
});

test('pages keep their own clicked names', () => {
  const coverage = new PageCoverage();
  runLevel(coverage, 'general', ['Save'], 5);
  const plan = coverage.plan('models', els(['Save']), 5);
  assert.deepEqual(plan.chosen.map((el) => el.name), ['Save']);
});

test('the permissions page at its CI counts is fully clicked: Regular 7, Advanced 58, Technical 86', () => {
  // Regular shows 1 to 7, Advanced shows 29 to 86, Technical shows all 86. The Technical cap of 90 takes what is left.
  const coverage = new PageCoverage();
  runLevel(coverage, 'permissions', range(1, 7), 24);
  const advanced = runLevel(coverage, 'permissions', range(29, 86), 24);
  assert.equal(advanced.chosen.length, 24);
  runLevel(coverage, 'permissions', range(1, 86), 90);
  assert.deepEqual(coverage.neverClicked(), []);
});
