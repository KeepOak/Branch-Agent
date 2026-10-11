import './permission-wait.test.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExternalHref, skipReason } from './denylist.mjs';
import { classifyClick, isNoise } from './observe.mjs';
import { chooseRegion, chooseScreenClicks } from './targets.mjs';
import { actionSet, inconsistentOpens, internalNameProblems, rowActionProblems } from './list-checks.mjs';
import { compareBaseline, formatGate } from './baseline.mjs';
import { isInformationalStatus, loadPreviewMap, previewDestinationMatches, threadLayoutDiff } from './preview-map.mjs';
import { countProblems } from './report.mjs';

const fixture = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/preview-map.sample.json'), 'utf8'));

const surface = (patch) => ({
  route: 'chat:agent:researcher:notes', dialog: null, menu: null, panel: null, toast: null,
  mainText: 'Research notes', alert: '', unimplemented: false, blank: false, control: '|||', focus: '',
  menuItems: [], requests: [], requestCount: 0, ...patch,
});

test('denylist skips destructive and external controls and clicks ordinary ones', () => {
  assert.equal(skipReason({ name: 'Delete this conversation' }), 'destructive');
  assert.equal(skipReason({ name: 'Sign out' }), 'destructive');
  assert.equal(skipReason({ name: 'Quit' }), 'destructive');
  assert.equal(skipReason({ name: 'Docs', href: 'https://example.com/docs' }), 'external-url');
  assert.equal(isExternalHref('mailto:someone@example.com'), true);
  assert.equal(skipReason({ name: 'Settings', href: '#main' }), null);
  assert.equal(skipReason({ name: 'Archive' }), null);
  assert.equal(skipReason({ name: 'Pin', disabled: true }), 'disabled');
});

test('denylist records external sign-in controls without clicking them', () => {
  for (const name of ['Connect GitHub', 'connect Google', 'CONNECT Microsoft', 'Sign in with Google', 'Continue with GitHub']) {
    assert.equal(skipReason({ name }), 'external-sign-in');
  }
  for (const name of ['Connect', 'New chat', 'Sign in', 'Continue', 'Reconnect GitHub', 'Connect to a Branch elsewhere…']) {
    assert.equal(skipReason({ name }), null);
  }
  assert.equal(skipReason({ name: 'Remove GitHub account' }), 'destructive');
  assert.equal(skipReason({ name: 'Connect GitHub', disabled: true }), 'disabled');
  assert.equal(skipReason({ name: 'Connect GitHub', href: 'https://github.com/login' }), 'external-url');
});

test('click classification flags dead, toast-only, slow, and error screens', () => {
  const before = surface({});
  assert.deepEqual(classifyClick({ before, after: surface({}), elapsedMs: 20 }).problems, ['dead']);
  const toast = classifyClick({
    before, after: surface({ toast: 'Saved.' }), elapsedMs: 40,
  });
  assert.deepEqual(toast.problems, ['toast-only']);
  assert.deepEqual(classifyClick({
    before, after: surface({ route: 'place:overview', mainText: 'Overview' }), elapsedMs: 450,
  }).problems, ['slow']);
  assert.ok(classifyClick({
    before, after: surface({ alert: 'Something went wrong', mainText: 'Something went wrong' }), elapsedMs: 30,
  }).problems.includes('error'));
  assert.ok(classifyClick({
    before, after: surface({ mainText: 'Coming soon', unimplemented: true }), elapsedMs: 20,
  }).problems.includes('unimplemented'));
  assert.ok(classifyClick({
    before, after: surface({ route: 'settings:missing', mainText: '', blank: true }), elapsedMs: 20,
  }).problems.includes('empty-route'));
  assert.deepEqual(classifyClick({
    before, after: surface({ requests: [{ method: 'config.patch', ok: true }], requestCount: 0 }), elapsedMs: 30,
  }).problems, ['dead']);
  assert.deepEqual(classifyClick({
    before, after: surface({ focus: 'Conversation' }), elapsedMs: 20,
  }).problems, []);
  assert.deepEqual(classifyClick({ before, after: surface({ chrome: 'dark' }), elapsedMs: 20 }).problems, []);
  assert.deepEqual(classifyClick({ before, after: surface({ hash: '#main' }), elapsedMs: 20 }).problems, []);
  assert.deepEqual(classifyClick({ before, after: surface({ historyMoves: 1 }), elapsedMs: 20 }).problems, ['dead']);
  assert.deepEqual(classifyClick({ before, after: surface({ alreadyCurrent: true }), elapsedMs: 20 }).problems, []);
  assert.equal(isNoise('Failed to load resource: favicon.ico'), true);
  assert.ok(classifyClick({
    before, after: surface({ dialog: 'Guide' }), elapsedMs: 20, consoleErrors: ['boom'],
  }).problems.includes('console-error'));
});

test('Copy link is toast-only, a menu that only closes is dead, and an ok RPC is dead', () => {
  const before = surface({});
  const copyLink = classifyClick({
    before,
    after: surface({ toast: "Couldn't copy." }),
  });
  assert.deepEqual(copyLink.problems, ['toast-only']);

  const menuCloses = classifyClick({
    before: surface({ menu: 'Conversation actions' }),
    after: surface({ menu: null, focus: 'Conversation actions' }),
  });
  assert.deepEqual(menuCloses.problems, ['dead']);

  const okOnly = classifyClick({
    before,
    after: surface({ requests: [{ method: 'sessions.share', ok: true, fixture: true }], requestCount: 1 }),
  });
  assert.deepEqual(okOnly.problems, ['dead']);
});

test('a navigation and a dialog are real results', () => {
  const before = surface({ route: 'place:overview', mainText: 'grove' });
  assert.deepEqual(classifyClick({
    before,
    after: surface({ route: 'place:canopy', mainText: 'canopy' }),
  }).problems, []);
  assert.deepEqual(classifyClick({
    before,
    after: surface({ route: 'place:overview', mainText: 'grove', dialog: 'Invite someone' }),
  }).problems, []);
});

test('the screen budget reaches Overview and Appearance controls', () => {
  const chrome = ['Skip to the page', 'Back', 'Forward', 'Guide', 'Dark'].map((name) => ({ name, region: 'chrome' }));
  const sidebar = ['Researcher', 'Builder', 'Studio computer'].map((name) => ({ name, region: 'sidebar' }));
  const nav = ['General', 'Appearance'].map((name) => ({ name, region: 'nav' }));
  const overview = ['Open Canopy', 'All history', 'Invite someone', 'Lockdown'].map((name) => ({ name, region: 'screen' }));
  const appearance = ['Light', 'Dark', 'Match this computer', 'Browse themes', 'Make your own'].map((name) => ({
    name,
    region: 'screen',
  }));
  assert.deepEqual(
    chooseScreenClicks([...chrome, ...sidebar, ...nav, ...overview], { limit: 12 }).map((el) => el.name),
    overview.map((el) => el.name),
  );
  const appearanceClicks = chooseScreenClicks([...chrome, ...sidebar, ...appearance], { limit: 12 }).map((el) => el.name);
  assert.ok(appearanceClicks.includes('Browse themes'));
  assert.ok(appearanceClicks.includes('Make your own'));
  assert.ok(appearanceClicks.includes('Light'));
  assert.deepEqual(
    chooseRegion([...chrome, ...overview], 'chrome', { limit: 16 }).map((el) => el.name),
    chrome.map((el) => el.name),
  );
  assert.deepEqual(chooseRegion(nav, 'nav', { limit: 40 }).map((el) => el.name), ['General', 'Appearance']);
});

test('sidebar rows must share pin, archive, and more, and must not show internal ids', () => {
  assert.deepEqual(actionSet(['Unpin', 'More for Ada']), ['more', 'pin']);
  const rows = [
    { label: 'Researcher', actions: ['Pin', 'More'] },
    { label: 'Studio computer', actions: ['Pin', 'Archive', 'More'] },
    { label: 'Quiet', actions: [] },
  ];
  assert.deepEqual(rowActionProblems(rows).map((row) => row.label), ['Researcher']);
  assert.deepEqual(internalNameProblems(['Researcher', 'agent:researcher:notes', 'Builder']), ['agent:researcher:notes']);
  assert.deepEqual(inconsistentOpens([
    { label: 'Researcher', kind: 'full' },
    { label: 'Studio computer', kind: 'popover' },
  ]), ['Studio computer']);
  assert.deepEqual(inconsistentOpens([{ label: 'Researcher', kind: 'full' }]), []);
});

test('baseline fails new problems and asks to delete stale ones', () => {
  const baseline = { 'place:overview :: Export': ['dead'] };
  const fresh = compareBaseline({
    baseline,
    found: { 'place:overview :: Export': ['dead'] },
    checks: [{ screenId: 'place:overview', complete: true, keys: ['place:overview :: Export'] }],
  });
  assert.equal(fresh.ok, true);
  const added = compareBaseline({
    baseline,
    found: { 'place:overview :: Export': ['dead', 'slow'] },
    checks: [{ screenId: 'place:overview', complete: true, keys: ['place:overview :: Export'] }],
  });
  assert.equal(added.ok, false);
  assert.match(formatGate(added).join('\n'), /New button-crawl problem: place:overview :: Export \[slow\]/);
  const fixed = compareBaseline({
    baseline,
    found: {},
    checks: [{ screenId: 'place:overview', complete: true, keys: ['place:overview :: Export'] }],
  });
  assert.match(formatGate(fixed).join('\n'), /stale baseline entry, delete it: place:overview :: Export \[dead\]/);
  const unseen = compareBaseline({
    baseline,
    found: {},
    checks: [{ screenId: 'place:inbox', complete: true, keys: [] }],
  });
  assert.equal(unseen.ok, true);
});

test('preview map counts come from the file and extra or unknown statuses do not gate', () => {
  const loaded = loadPreviewMap(fixture);
  const expected = {};
  for (const entry of fixture) expected[entry.status] = (expected[entry.status] || 0) + 1;
  assert.deepEqual(loaded.counts, expected);
  assert.equal(loaded.informational.some((entry) => entry.status === 'extra'), true);
  assert.equal(loaded.informational.some((entry) => entry.status === 'surprise'), true);
  assert.equal(isInformationalStatus('extra'), true);
  assert.equal(isInformationalStatus('surprise'), true);
  assert.equal(isInformationalStatus('different'), false);
  assert.equal(previewDestinationMatches('Opens the Guide popover.', { dialog: 'Guide' }), true);
  assert.equal(previewDestinationMatches('Navigates to Overview.', { route: 'place:overview' }), true);
  assert.equal(previewDestinationMatches('Opens the Guide popover.', { dead: true, route: 'chat:a' }), false);
  const diff = threadLayoutDiff(['Column', 'Hidden']);
  assert.deepEqual(diff.missing, ['Emoji rail', 'Tabs above the chat', 'Side tabs']);
  assert.deepEqual(diff.extra, ['Hidden']);
  const gated = countProblems({ 'sidebar :: Back': ['dead'] });
  assert.equal(gated.dead, 1);
  assert.equal(gated['missing-button'], undefined);
});
