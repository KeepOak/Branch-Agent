// Unit tests for the pure parts of frame-level QA. No browser is started here.
// Run: node --test scripts/frame-qa/frame-qa.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankFrames, findFlickers, firstChangeMs, frameIntervalMedian, idleChurn, layoutShiftFindings, scrollResetFindings, stableMs } from './analyze.mjs';
import { auditContrast, contrastRatio, parseColor, requiredRatio } from './contrast.mjs';
import { auditLines, lineFor, uniqueFindings } from './audit-lines.mjs';
import { VisitedGraph, controlId, orderControls, traverse } from './traverse.mjs';
import { TRACE_OPTIONS, VIDEO_SIZE, contextOptions, openRootContext } from './browser-options.mjs';

const frames = (pairs) => pairs.map(([t, hash, bytes = 40000]) => ({ t, hash, bytes }));

test('a change that returns to the earlier picture within 300 ms is a flicker', () => {
  const found = findFlickers(frames([[0, 'a'], [16, 'a'], [32, 'b'], [48, 'a'], [64, 'a']]));
  assert.equal(found.length, 1);
  assert.equal(found[0].gapMs, 32, 'from the last earlier frame (16) to the return (48)');
});

test('a change that returns after more than 300 ms is not a flicker', () => {
  const found = findFlickers(frames([[0, 'a'], [16, 'b'], [400, 'a']]));
  assert.equal(found.length, 0);
});

test('first change and stable frame are measured from the click', () => {
  const f = frames([[100, 'a'], [120, 'b'], [140, 'c'], [160, 'c'], [600, 'd']]);
  assert.equal(firstChangeMs(f, 100), 20);
  assert.equal(stableMs(f, 100, 100, 1000), 40, 'the first burst ends at 140 ms, 40 ms after the click');
});

test('a picture that never settles reports no stable frame', () => {
  const f = frames([[0, 'a'], [50, 'b'], [100, 'c'], [150, 'd']]);
  assert.equal(stableMs(f, 0, 100, 200), null);
});

test('idle churn needs changes in two of the three bins between 2 s and 5 s', () => {
  const quiet = frames([[0, 'a'], [100, 'a']]);
  assert.equal(idleChurn(quiet, 0).flagged, false);
  const ticking = frames([[0, 'a'], [2100, 'b'], [3100, 'c'], [4200, 'd']]);
  assert.equal(idleChurn(ticking, 0).flagged, true);
  assert.equal(idleChurn(ticking, 0).changedBins, 3);
});

test('frame interval reports the median gap between changed frames', () => {
  assert.equal(frameIntervalMedian(frames([[0, 'a'], [16, 'b'], [50, 'c'], [66, 'd']])), 16);
});

test('blank frames are the small ones', () => {
  assert.equal(blankFrames(frames([[0, 'a', 1200], [16, 'b', 90000]])).length, 1);
});

test('layout shifts and scroll jumps are filtered by input and size', () => {
  assert.equal(layoutShiftFindings([{ value: 0.2, hadRecentInput: true }, { value: 0.01, hadRecentInput: false }]).length, 1);
  assert.equal(scrollResetFindings([{ from: 0, to: 10 }, { from: 500, to: 0 }]).length, 1);
});

test('contrast parses rgb, rgba and percent alpha', () => {
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 });
  assert.deepEqual(parseColor('rgba(10, 20, 30, 0.5)'), { r: 10, g: 20, b: 30, a: 0.5 });
  assert.equal(parseColor('transparent'), null);
});

test('black on white is 21:1 and the AA thresholds are applied by size', () => {
  assert.equal(Math.round(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })), 21);
  assert.equal(requiredRatio({ fontSizePx: 14, fontWeight: 400 }), 4.5);
  assert.equal(requiredRatio({ fontSizePx: 24, fontWeight: 400 }), 3);
  assert.equal(requiredRatio({ fontSizePx: 19, fontWeight: 700 }), 3);
});

test('contrast audit flags low-contrast text and exempts disabled controls', () => {
  const failures = auditContrast([
    { text: 'Nothing waiting', color: 'rgb(170, 170, 170)', background: 'rgb(255, 255, 255)', fontSizePx: 14, fontWeight: 400, opacity: 1 },
    { text: 'Disabled', color: 'rgb(170, 170, 170)', background: 'rgb(255, 255, 255)', fontSizePx: 14, fontWeight: 400, opacity: 1, disabled: true },
  ]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].text, 'Nothing waiting');
});

test('control ids keep shared chrome global and screen controls per root', () => {
  const chrome = { region: 'chrome', name: 'Back', occurrence: 0 };
  const screen = { region: 'screen', name: 'Back', occurrence: 0 };
  assert.match(controlId({ rootId: 'place:a', path: [], control: chrome }), /^global \|/);
  assert.match(controlId({ rootId: 'place:a', path: [], control: screen }), /^place:a \|/);
});

test('overlay controls are ordered first, then the screen, then the chrome', () => {
  const ordered = orderControls([
    { region: 'chrome', name: 'c' }, { region: 'screen', name: 's' }, { region: 'overlay', name: 'o' },
  ]).map((c) => c.name);
  assert.deepEqual(ordered, ['o', 's', 'c']);
});

/**
 * A fake app. Root "home" has: Menu (opens a menu with Item1 and Item2), Dead (changes nothing),
 * Go (navigates to "other"), Delete (destructive, must be skipped), and Menu2 (opens the same menu
 * contents as Menu, so it should be linked, not walked twice).
 */
function fakeAdapter() {
  const calls = { acts: [], replays: 0, escapes: 0 };
  const state = { root: null, open: null };
  const screenControls = [
    { name: 'Menu', region: 'screen', occurrence: 0 },
    { name: 'Dead', region: 'screen', occurrence: 0 },
    { name: 'Go', region: 'screen', occurrence: 0 },
    { name: 'Delete', region: 'screen', occurrence: 0 },
    { name: 'Menu2', region: 'screen', occurrence: 0 },
  ];
  const menuControls = [
    { name: 'Item1', region: 'overlay', occurrence: 0 },
    { name: 'Item2', region: 'overlay', occurrence: 0 },
  ];
  const outcome = {
    Menu: { opensOverlay: true, overlay: 'menu-a' },
    Menu2: { opensOverlay: true, overlay: 'menu-a' },
    Dead: { dead: true },
    Go: { navigated: true, route: 'other' },
  };
  return {
    calls,
    async beginRoot(rootEntry) { state.root = rootEntry; state.open = null; },
    async endRoot() {},
    async listControls(overlayOpen) { return overlayOpen ? menuControls : screenControls; },
    skipReason(control) { return control.name === 'Delete' ? 'destructive' : null; },
    async signature() { return `${state.root.id}|${state.open || ''}`; },
    async replay(root, path) { calls.replays += 1; state.root = root; state.open = path.length ? 'menu-a' : null; },
    async act(control) {
      calls.acts.push(control.name);
      const o = outcome[control.name] || {};
      if (o.opensOverlay) state.open = o.overlay;
      return { problems: [], dead: Boolean(o.dead), opensOverlay: Boolean(o.opensOverlay), navigated: Boolean(o.navigated), route: o.route, evidence: [] };
    },
    async overlayState() { return state.open ? 'menu-a|items:Item1;Item2' : null; },
    async escape() { calls.escapes += 1; state.open = null; return false; },
  };
}

test('the traversal visits every control once, skips destructive ones, and links repeated overlays', async () => {
  const adapter = fakeAdapter();
  const graph = new VisitedGraph();
  await traverse({ roots: [{ id: 'home', route: { kind: 'place', place: 'home' } }], adapter, graph, maxDepth: 3, now: () => 0 });
  const names = [...graph.nodes.values()].map((n) => `${n.label}:${n.status}`);
  assert.ok(names.includes('Menu:pass'));
  assert.ok(names.includes('Dead:dead-end'));
  assert.ok(names.includes('Delete:skipped'));
  assert.ok(names.includes('Item1:pass'), 'the overlay items are walked');
  assert.equal(adapter.calls.acts.filter((n) => n === 'Delete').length, 0, 'destructive controls are never clicked');
  assert.equal(graph.summary().overlayLinks, 1, 'Menu2 opens the same overlay and is linked, not walked again');
  assert.equal(graph.summary().navigationEdges, 1);
});

test('an overlay that Escape cannot close is recorded as no-way-back', async () => {
  const adapter = fakeAdapter();
  adapter.escape = async () => true;
  const graph = new VisitedGraph();
  await traverse({ roots: [{ id: 'home', route: { kind: 'place', place: 'home' } }], adapter, graph, maxDepth: 3, now: () => 0 });
  const menu = [...graph.nodes.values()].find((n) => n.label === 'Menu');
  assert.ok(menu.problems.includes('no-way-back'));
});

test('the deadline stops the walk and leaves the rest not-reached', async () => {
  const adapter = fakeAdapter();
  const graph = new VisitedGraph();
  let t = 0;
  await traverse({ roots: [{ id: 'home', route: { kind: 'place', place: 'home' } }], adapter, graph, maxDepth: 3, deadlineMs: 1, now: () => { t += 1; return t; } });
  assert.ok(graph.nodes.size < 6);
});

test('audit lines carry id, place and control, OS, what happened, repro and evidence', () => {
  const finding = { kind: 'flicker', root: 'place:overview', control: 'Dark', repro: ['open place:overview', 'click Dark'], detail: { flickerGapsMs: [16] }, timings: { firstChangeMs: 5 }, evidence: ['frames/x-after.jpg'] };
  const line = lineFor(finding, 'QA-MAC-001', 'mac');
  assert.match(line, /^- QA-MAC-001 \| place:overview › Dark \| macOS \(Chromium on mac\) \| flicker \[load-affected\]: picture changed/);
  assert.match(line, /repro: open place:overview → click Dark/);
  assert.match(line, /evidence: x-after\.jpg/);
});

test('audit lines are unique per finding and numbered per OS', () => {
  const base = { kind: 'dead-end', root: 'place:a', control: 'X', repro: ['click X'], detail: {}, evidence: [] };
  assert.equal(uniqueFindings([base, base]).length, 1);
  assert.match(auditLines([base], 'linux')[0], /^- QA-LINUX-001 /);
});

test('a crashed page is recorded and recovered, and the walk continues with the next control', async () => {
  const adapter = fakeAdapter();
  const original = adapter.act;
  let recovered = 0;
  adapter.act = async (control) => {
    if (control.name === 'Go') throw new Error('Target crashed');
    return original(control);
  };
  adapter.recover = async () => { recovered += 1; };
  const graph = new VisitedGraph();
  await traverse({ roots: [{ id: 'home', route: { kind: 'place', place: 'home' } }], adapter, graph, maxDepth: 3, now: () => 0 });
  const go = [...graph.nodes.values()].find((n) => n.label === 'Go');
  assert.deepEqual(go.problems, ['browser-crash']);
  assert.equal(recovered, 1);
  assert.ok([...graph.nodes.values()].some((n) => n.label === 'Menu' && n.status === 'pass'), 'controls after the crash are still walked');
});

test('page-level findings with the same text collapse to one line across roots and overlays', () => {
  const a = { kind: 'contrast', root: 'place:a', control: '(screen)', repro: ['open place:a'], detail: '"Nothing" 3.4:1, needs 4.5:1', evidence: [] };
  const b = { ...a, root: 'place:b', control: '(overlay of X)', repro: ['open place:b'] };
  assert.equal(uniqueFindings([a, b]).length, 1);
});

test('node findings with different controls stay separate', () => {
  const a = { kind: 'dead-end', root: 'place:a', control: 'X', repro: ['click X'], detail: {}, evidence: [] };
  const b = { ...a, control: 'Y', repro: ['click Y'] };
  assert.equal(uniqueFindings([a, b]).length, 2);
});

test('if recovery itself throws, the crash is recorded a second time and the walk continues', async () => {
  const adapter = fakeAdapter();
  const original = adapter.act;
  adapter.act = async (control) => {
    if (control.name === 'Go') throw new Error('Target crashed');
    return original(control);
  };
  adapter.recover = async () => { throw new Error('reopen failed'); };
  const graph = new VisitedGraph();
  await traverse({ roots: [{ id: 'home', route: { kind: 'place', place: 'home' } }], adapter, graph, maxDepth: 3, now: () => 0 });
  const go = [...graph.nodes.values()].find((n) => n.label === 'Go');
  assert.deepEqual(go.problems, ['browser-crash', 'recover-failed']);
  assert.ok([...graph.nodes.values()].some((n) => n.label === 'Menu' && n.status === 'pass'), 'controls after a failed reopen are still walked');
});

test('traces keep snapshots but drop screenshots', () => {
  assert.equal(TRACE_OPTIONS.screenshots, false);
  assert.equal(TRACE_OPTIONS.snapshots, true);
});

test('a root context starts its trace with the trace options, and the context gets the capped video', async () => {
  const calls = [];
  const fakeBrowser = {
    async newContext(options) {
      calls.push({ call: 'newContext', options });
      return { tracing: { async start(opts) { calls.push({ call: 'tracing.start', options: opts }); } } };
    },
  };
  await openRootContext(fakeBrowser, { out: '/tmp/out', safe: 'place-overview' });
  const trace = calls.find((c) => c.call === 'tracing.start');
  assert.deepEqual(trace.options, TRACE_OPTIONS, 'tracing.start is called with the trace options');
  assert.equal(trace.options.screenshots, false);
  const ctx = calls.find((c) => c.call === 'newContext');
  assert.deepEqual(ctx.options.recordVideo.size, VIDEO_SIZE);
});

test('video is capped at 960x600 for every root context', () => {
  assert.ok(VIDEO_SIZE.width <= 960 && VIDEO_SIZE.height <= 600);
  const options = contextOptions({ out: '/tmp/out', safe: 'place-overview' });
  assert.deepEqual(options.recordVideo.size, VIDEO_SIZE);
  assert.match(options.recordVideo.dir, /videos[\\/]place-overview$/);
});
