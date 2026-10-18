import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISABLED_REASON_ALLOW, DISABLED_WITHOUT_REASON, disabledWithoutReason } from './disabled-reason.mjs';
import { compareBaseline, formatGate } from './baseline.mjs';
import { GATED_PROBLEMS } from './observe.mjs';

const control = (name, patch) => ({ name, href: '', disabled: false, noReason: false, selected: false, occurrence: 0, region: 'screen', ...patch });

test('a greyed control with no visible reason is flagged at Regular and Advanced', () => {
  const elements = [
    control('Run now', { disabled: true, noReason: false }),
    control('Pause', { disabled: true, noReason: true }),
    control('Check now'),
  ];
  assert.deepEqual(disabledWithoutReason(elements, 'regular').map((el) => el.name), ['Pause']);
  assert.deepEqual(disabledWithoutReason(elements, 'advanced').map((el) => el.name), ['Pause']);
});

test('Technical screens and enabled controls are not held to the reason rule', () => {
  assert.deepEqual(disabledWithoutReason([control('Pause', { disabled: true, noReason: true })], 'technical'), []);
  assert.deepEqual(disabledWithoutReason([control('Pause', { disabled: true, noReason: true })], undefined), []);
  assert.deepEqual(disabledWithoutReason([control('Run now', { noReason: true })], 'regular'), []);
});

test('only the header history arrows are allowed greyed without a line, each with its reason', () => {
  assert.deepEqual(Object.keys(DISABLED_REASON_ALLOW).sort(), ['chrome :: Back', 'chrome :: Forward']);
  for (const why of Object.values(DISABLED_REASON_ALLOW)) assert.ok(why.length > 20);
  const back = control('Back', { region: 'chrome', disabled: true, noReason: true });
  assert.deepEqual(disabledWithoutReason([back], 'regular'), []);
  // The allow list is by region: a greyed Back inside a page still needs its line.
  assert.deepEqual(disabledWithoutReason([{ ...back, region: 'screen' }], 'regular').map((el) => el.name), ['Back']);
});

test('disabled-without-reason fails the gate the way dead does', () => {
  assert.ok(GATED_PROBLEMS.includes(DISABLED_WITHOUT_REASON));
  const key = 'settings:usage@regular :: Pause';
  const found = { [key]: [DISABLED_WITHOUT_REASON] };
  const gate = compareBaseline({ baseline: {}, found, checks: [{ screenId: 'settings:usage@regular', complete: true, keys: [key] }] });
  assert.equal(gate.ok, false);
  assert.deepEqual(gate.news, [{ key, problem: DISABLED_WITHOUT_REASON }]);
  assert.deepEqual(formatGate(gate), [`New button-crawl problem: ${key} [${DISABLED_WITHOUT_REASON}]`]);
  const dead = compareBaseline({ baseline: {}, found: { [key]: ['dead'] }, checks: [] });
  assert.equal(dead.ok, gate.ok);
});
