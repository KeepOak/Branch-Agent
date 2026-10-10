#!/usr/bin/env node
// Frame-level QA for the Branch window. Runs the fixture harness (no live engine), walks every control
// depth-first with a visited graph, and records what each click does frame by frame.
// Configuration is by environment variable; see README.md. Writes paths.json and findings.jsonl.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { skipReason } from '../button-crawl/denylist.mjs';
import { classifyClick, isNoise } from '../button-crawl/observe.mjs';
import { auditContrast } from './contrast.mjs';
import { layoutShiftFindings, scrollResetFindings } from './analyze.mjs';
import { analyzeWindow, saveFrame, startScreencast, waitQuiet } from './capture.mjs';
import { clickPoint, describeActive, installProbes, scanClipped, scanContrast, tagScrollables } from './probes.mjs';
import { traverse, VisitedGraph } from './traverse.mjs';
import { openRootContext } from './browser-options.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const windowDir = resolve(root, 'window');
const require = createRequire(resolve(windowDir, 'package.json'));
const { chromium } = require('playwright');

const env = process.env;
const osName = env.FRAME_QA_OS || { darwin: 'mac', linux: 'linux', win32: 'windows' }[process.platform] || process.platform;
const config = {
  os: osName,
  out: resolve(env.FRAME_QA_OUT || join(root, 'frame-qa-output', osName)),
  port: Number(env.FRAME_QA_PORT) || 5663,
  baseUrl: env.FRAME_QA_URL || '',
  budgetMs: (Number(env.FRAME_QA_BUDGET_MIN) || 60) * 60000,
  maxDepth: Number(env.FRAME_QA_MAX_DEPTH) || 3,
  rootFilter: (env.FRAME_QA_ROOTS || '').split(',').map((s) => s.trim()).filter(Boolean),
  chromeArgs: [...(env.FRAME_QA_CHROME_ARGS || '').split(' ').filter(Boolean), ...(process.getuid?.() === 0 ? ['--no-sandbox'] : [])],
};
const SCAN_CAP = 400;
const NOT_A_FINDING = new Set(['not-found']);

/** Same state fingerprint the button crawl uses to decide whether a click changed anything. */
function signatureOf(s) {
  return [s.route, s.dialog, s.menu, s.panel, s.toast, s.mainText, s.viewText, s.control, s.alert, s.focus, s.hash, s.chrome, s.historyMoves].join('\n');
}

/** Short fingerprint of the base state, used only to decide whether a replay is needed. */
function baseOf(s) {
  return `${s.route}|${s.dialog || ''}|${s.menu || ''}`;
}

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function waitForUrl(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
    } catch { /* server still starting */ }
    await sleep(250);
  }
  throw new Error(`harness did not answer on ${url}`);
}

function startVite() {
  const windows = process.platform === 'win32';
  // pnpm is a .cmd shim on Windows, which only starts through a shell. Process groups exist only on POSIX.
  const child = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', String(config.port), '--strictPort'], {
    cwd: windowDir, detached: !windows, shell: windows, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let log = '';
  const keep = (chunk) => { log = (log + chunk.toString()).slice(-4000); };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  return child;
}

function stopVite(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') { child.kill(); return; }
  try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
}

/** Drives one browser context per root and implements the traversal's adapter interface. */
class HarnessAdapter {
  constructor({ browser, harnessUrl, out, findings }) {
    this.browser = browser;
    this.harnessUrl = harnessUrl;
    this.out = out;
    this.findings = findings;
    this.statsByRoot = {};
    this.stats = {};
    this.context = null;
    this.page = null;
    this.ring = null;
    this.root = null;
    this.errors = [];
    this.warnings = [];
    this.failed = [];
    this.seenKeys = new Set();
    this.trailDone = new Set();
    this.trigger = '';
    this.evidence = 0;
  }

  live() {
    return { page: this.page, ring: this.ring };
  }

  record(entry) {
    const key = `${entry.kind}|${entry.root}|${entry.control}|${entry.detail}`;
    if (this.seenKeys.has(key)) return;
    this.seenKeys.add(key);
    this.findings.push({ ...entry, os: config.os });
  }

  async beginRoot(rootEntry) {
    await this.closeContext();
    this.root = rootEntry;
    this.stats = this.statsByRoot[rootEntry.id] = {};
    this.errors = [];
    this.warnings = [];
    this.failed = [];
    const safe = rootEntry.id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
    // openRootContext starts the trace with snapshots and no screenshots, which keeps traces small.
    this.context = await openRootContext(this.browser, { out: this.out, safe });
    await this.context.addInitScript(`(${installProbes.toString()})();`);
    this.page = await this.context.newPage();
    this.attach(this.page);
    this.ring = (await startScreencast(this.page)).ring;
    await this.page.goto(this.harnessUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await this.ready();
    this.pristine = await this.page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    await this.mountRoute(rootEntry.route);
    await this.rootChecks(rootEntry);
  }

  attach(page) {
    page.on('console', (message) => {
      if (message.type() === 'error' && !isNoise(message.text())) this.errors.push(message.text());
      if (message.type() === 'warning' && !isNoise(message.text())) this.warnings.push(message.text());
    });
    page.on('pageerror', (error) => this.errors.push(String(error)));
    page.on('requestfailed', (request) => this.failed.push(`${request.method()} ${request.url()}`));
  }

  async closeContext() {
    if (!this.context) return;
    const page = this.page;
    const video = page?.video();
    await this.context.tracing.stop({ path: join(this.out, 'traces', `${this.safeId()}.zip`) }).catch(() => undefined);
    await this.context.close().catch(() => undefined);
    const path = await video?.path().catch(() => null);
    if (path && existsSync(path)) renameSync(path, join(this.out, 'videos', `${this.safeId()}.webm`));
    this.context = null;
    this.page = null;
  }

  safeId() {
    return (this.root?.id || 'root').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  }

  /** Shortcut and wheel probes change the screen, so they run after the walk, never before it. */
  /** Reopens a root after its page crashed, and records the crash. The walk replays the path from there. */
  async recover(rootEntry, reason) {
    this.record({ kind: 'browser-crash', root: rootEntry.id, place: rootEntry.id, control: '(page)', detail: `renderer crashed, root reopened: ${reason.slice(0, 160)}`, evidence: [] });
    await this.closeContext();
    await this.beginRoot(rootEntry);
  }

  async endRoot(rootEntry) {
    if (this.page) {
      await this.shortcutChecks(rootEntry);
      await this.scrollChecks(rootEntry);
    }
    await this.closeContext();
  }

  async ready() {
    await this.page.locator('[data-connection="ready"]').waitFor({ timeout: 30000 });
  }

  /** Mounts a route and waits for the window to be ready. The mount time is recorded for slow-paint checks. */
  async mountRoute(route) {
    const t0 = Date.now();
    await this.page.evaluate((r) => window.__crawl.mount(r), route);
    await this.ready();
    this.lastMountAt = t0;
    return t0;
  }

  async surface() {
    return this.page.evaluate(() => window.__crawl.surface());
  }

  async signature() {
    return baseOf(await this.surface());
  }

  async listControls(overlayOpen) {
    const controls = await this.page.evaluate((o) => window.__crawl.collect(o), overlayOpen);
    if (overlayOpen) await this.overlayChecks();
    this.stats.controls = (this.stats.controls || 0) + controls.filter((c) => c.region !== 'chrome').length;
    return controls;
  }

  skipReason(control) {
    return skipReason(control);
  }

  async overlayState() {
    const s = await this.surface();
    if (!s.dialog && !s.menu) return null;
    return `${s.dialog || ''}|${s.menu || ''}|${[...(s.menuItems || [])].sort().join(';')}`;
  }

  /** Clicks a control like a person: move, hover, press, release. Then watches the frames. */
  async act(control) {
    const { page, ring } = this.live();
    const before = await this.surface();
    await waitQuiet(ring, 150, 1200);
    // mark() scrolls the control into view, which is a programmatic scroll, not a user one. Clear the probe log after it.
    const marked = await page.evaluate(([c]) => window.__crawl.mark(c.name, c.occurrence, c.region), [control]);
    if (!marked) return { problems: ['not-found'], dead: false, opensOverlay: false, navigated: false, evidence: [], control: control.name };
    const point = await page.evaluate(clickPoint);
    if (!point) return { problems: ['not-found'], dead: false, opensOverlay: false, navigated: false, evidence: [], control: control.name };
    await page.evaluate(() => window.__qa?.reset());
    await waitQuiet(ring, 100, 600);
    this.trigger = control.name;
    await page.mouse.move(point.x, point.y);
    const hoverT0 = Date.now();
    await sleep(150);
    const hover = ring.between(hoverT0, Date.now());
    const errorFrom = this.errors.length;
    const warnFrom = this.warnings.length;
    const failFrom = this.failed.length;
    const t0 = Date.now();
    await page.mouse.click(point.x, point.y);
    const { after, elapsedMs, leftPage } = await this.settle(before, t0);
    const opensOverlay = Boolean(after.dialog || after.menu) && (after.dialog !== before.dialog || after.menu !== before.menu);
    const navigated = before.route !== after.route;
    const windowMs = opensOverlay || navigated ? 5000 : 2000;
    await sleep(Math.max(0, t0 + windowMs - Date.now()));
    return this.observe({ before, after, t0, elapsedMs, leftPage, point, hover, errorFrom, warnFrom, failFrom, windowMs, opensOverlay, navigated, control });
  }

  async settle(before, t0) {
    let after = before;
    let leftPage = false;
    const signature = signatureOf(before);
    for (;;) {
      try {
        after = await this.surface();
      } catch {
        leftPage = true;
        break;
      }
      if (signatureOf(after) !== signature || Date.now() - t0 > 450) break;
      await sleep(16);
    }
    return { after, elapsedMs: Date.now() - t0, leftPage };
  }

  async observe(ctx) {
    const { before, after, t0, elapsedMs, point, hover, errorFrom, warnFrom, failFrom, windowMs, opensOverlay, navigated, control } = ctx;
    const consoleErrors = this.errors.slice(errorFrom);
    const failedCalls = (after.requests || []).slice(before.requestCount || 0).filter((call) => call && call.ok === false);
    const analysis = analyzeWindow(this.ring, { t0, windowMs, lastInputAt: t0 });
    const classified = classifyClick({ before, after, elapsedMs: analysis.firstChangeMs ?? elapsedMs, consoleErrors, failedCalls });
    const problems = new Set(classified.problems);
    if (!point.reached) problems.add('click-intercepted');
    if (analysis.flickers.length) problems.add('flicker');
    if (analysis.slowPaint) problems.add('slow-first-paint');
    if (analysis.blankBefore) problems.add('blank-before-content');
    if (windowMs === 5000 && analysis.idle.flagged) problems.add('idle-churn');
    const shifts = await this.page.evaluate(() => window.__qa?.shifts || []);
    if (layoutShiftFindings(shifts).length) problems.add('layout-shift');
    const jumps = await this.page.evaluate(() => window.__qa?.jumps || []);
    if (scrollResetFindings(jumps).length) problems.add('scroll-reset');
    const rejections = await this.page.evaluate(() => (window.__qa?.rejections || []).slice());
    if (rejections.length) problems.add('unhandled-rejection');
    const newWarnings = this.warnings.slice(warnFrom);
    if (newWarnings.some((w) => /key|act\(|Warning:/i.test(w))) problems.add('react-warning');
    if (this.failed.length > failFrom) problems.add('request-failed');
    const evidence = await this.saveEvidence(analysis, t0, problems);
    const dead = classified.problems.includes('dead') || classified.problems.includes('toast-only');
    return {
      problems: [...problems].sort(), dead, opensOverlay, navigated, route: after.route, control: control.name,
      evidence,
      timings: { settleMs: elapsedMs, firstChangeMs: analysis.firstChangeMs, stableMs: analysis.stableMs, intervalMedianMs: analysis.intervalMedianMs, frames: analysis.frameCount },
      hoverChanged: hover.length > 1 && hover.some((f, i) => i > 0 && f.hash !== hover[i - 1].hash),
      idle: windowMs === 5000 ? analysis.idle : null,
      flickers: analysis.flickers,
      details: { shifts: layoutShiftFindings(shifts).slice(0, 3), jumps: scrollResetFindings(jumps).slice(0, 3), rejections: rejections.slice(0, 2), warnings: newWarnings.slice(0, 2), failed: this.failed.slice(failFrom, failFrom + 2), errors: consoleErrors.slice(0, 2), flickerGapsMs: analysis.flickers.slice(0, 3).map((f) => f.gapMs), idleBins: windowMs === 5000 ? analysis.idle.changedBins : null, blankBefore: analysis.blankBefore, clickPoint: point.hit, reached: point.reached },
    };
  }

  async saveEvidence(analysis, t0, problems) {
    if (!problems.size || this.evidence >= 400) return [];
    this.evidence += 1;
    const name = `${this.safeId()}-${String(this.evidence).padStart(4, '0')}`;
    const files = [];
    if (saveFrame(this.out, `${name}-after`, this.ring.imageAt(t0 + 1500))) files.push(`frames/${name}-after.jpg`);
    const flicker = analysis.flickers[0];
    if (flicker) {
      const a = saveFrame(this.out, `${name}-flicker-a`, this.ring.imageAt(flicker.fromT));
      const b = saveFrame(this.out, `${name}-flicker-b`, this.ring.imageAt(flicker.toT));
      if (a && b) files.push(`frames/${name}-flicker-a.jpg`, `frames/${name}-flicker-b.jpg`);
    }
    return files;
  }

  /** Scans contrast, clipped text and scrollables for the current screen. Deduplicated across the run. */
  async rootChecks(rootEntry) {
    const idleT0 = this.lastMountAt;
    await sleep(5000);
    const idle = analyzeWindow(this.ring, { t0: idleT0, windowMs: 5000, lastInputAt: idleT0 });
    if (idle.idle.flagged) this.record({ kind: 'idle-churn', root: rootEntry.id, place: rootEntry.id, control: '(root open)', detail: `changed in ${idle.idle.changedBins} of 3 one-second bins, 2-5 s after open`, timings: idle.idle, frames: idle.frameCount, evidence: [] });
    if (idle.slowPaint) this.record({ kind: 'slow-first-paint', root: rootEntry.id, place: rootEntry.id, control: '(root open)', detail: `first stable frame at ${idle.stableMs} ms`, timings: { stableMs: idle.stableMs }, evidence: [] });
    if (idle.blankBefore) this.record({ kind: 'blank-before-content', root: rootEntry.id, place: rootEntry.id, control: '(root open)', detail: `${idle.blankBefore.blankFrames} flat frame(s), content after ${idle.blankBefore.contentAfterMs} ms`, evidence: [] });
    await this.staticChecks(rootEntry.id, '(screen)');
    this.stats.idle = { changedBins: idle.idle.changedBins, flagged: idle.idle.flagged, stableMs: idle.stableMs };
  }

  async staticChecks(rootId, label) {
    const clipped = await this.page.evaluate(scanClipped);
    for (const item of clipped.slice(0, SCAN_CAP)) {
      const key = /[\w.+-]+@[\w-]+\.[\w.]+|\b\d{1,2}:\d{2}\b|reset/i.test(item.text);
      if (key) this.record({ kind: 'clipped-key-info', root: rootId, place: rootId, control: label, detail: `clipped: "${item.text.slice(0, 120)}"`, evidence: [] });
    }
    const items = await this.page.evaluate(scanContrast);
    for (const failure of auditContrast(items).slice(0, 50)) {
      this.record({ kind: 'contrast', root: rootId, place: rootId, control: label, detail: `"${failure.text}" ${failure.ratio}:1, needs ${failure.need}:1`, evidence: [] });
    }
  }

  async overlayChecks() {
    const state = await this.overlayState();
    if (!state || this.trailDone.has(state)) return;
    this.trailDone.add(state);
    await this.staticChecks(this.root.id, `(overlay of ${this.trigger})`);
    const trail = [];
    for (let i = 0; i < 12; i += 1) {
      await this.page.keyboard.press('Tab');
      trail.push(await this.page.evaluate(describeActive));
    }
    if (trail.slice(1).some((step) => step === 'body')) {
      this.record({ kind: 'focus-loss', root: this.root.id, place: this.root.id, control: this.trigger, detail: `focus fell to body during Tab: ${trail.join(' > ')}`, evidence: [] });
    }
  }

  async escape() {
    const before = await this.page.evaluate(describeActive);
    await this.page.keyboard.press('Escape');
    await sleep(150);
    const stillOpen = await this.page.evaluate(() => Boolean(document.querySelector('[role="dialog"], [role="menu"]')));
    if (stillOpen) {
      this.record({ kind: 'keyboard-trap', root: this.root.id, place: this.root.id, control: this.trigger, detail: `Escape did not close the overlay (focus at ${before})`, evidence: [] });
    } else if ((await this.page.evaluate(describeActive)) === 'body') {
      this.record({ kind: 'focus-loss', root: this.root.id, place: this.root.id, control: this.trigger, detail: 'Escape closed the overlay and focus fell to body instead of returning to the trigger', evidence: [] });
    }
    return stillOpen;
  }

  /** Replays a path from the root: mounts the route and clicks each step with the mouse. */
  async replay(rootEntry, path) {
    await this.page.evaluate((saved) => {
      const state = JSON.parse(saved);
      localStorage.clear();
      sessionStorage.clear();
      for (const [k, v] of Object.entries(state.local)) localStorage.setItem(k, v);
      for (const [k, v] of Object.entries(state.session)) sessionStorage.setItem(k, v);
    }, this.pristine);
    await this.mountRoute(rootEntry.route);
    for (const step of path) {
      const marked = await this.page.evaluate(([s]) => window.__crawl.mark(s.name, s.occurrence, s.region), [step]);
      if (!marked) return false;
      const point = await this.page.evaluate(clickPoint);
      if (!point) return false;
      await this.page.mouse.click(point.x, point.y);
      await waitQuiet(this.ring, 120, 800);
    }
    return true;
  }

  async shortcutChecks(rootEntry) {
    const combos = ['ControlOrMeta+k', 'ControlOrMeta+i', 'ControlOrMeta+,'];
    for (const combo of combos) {
      const before = await this.surface();
      await this.page.keyboard.press(combo);
      await sleep(350);
      const after = await this.surface();
      const responded = after.route !== before.route || after.dialog !== before.dialog || after.menu !== before.menu;
      this.stats.shortcuts = [...(this.stats.shortcuts || []), { combo, responded }];
      await this.page.keyboard.press('Escape');
      await sleep(120);
      await this.page.keyboard.press('Escape');
      await sleep(120);
    }
  }

  async scrollChecks(rootEntry) {
    const scrollers = await this.page.evaluate(tagScrollables);
    for (const scroller of scrollers.slice(0, 6)) {
      const top0 = await this.page.evaluate((i) => document.querySelector(`[data-qa-scroll="${i}"]`)?.scrollTop ?? -1, scroller.index);
      await this.page.mouse.move(scroller.x, scroller.y);
      await this.page.mouse.wheel(0, 240);
      await sleep(300);
      const top1 = await this.page.evaluate((i) => document.querySelector(`[data-qa-scroll="${i}"]`)?.scrollTop ?? -1, scroller.index);
      await this.page.mouse.wheel(0, -240);
      await sleep(200);
      if (top0 >= 0 && top1 === top0 && scroller.scrollHeight > scroller.clientHeight + 20) {
        this.record({ kind: 'scroll-dead', root: rootEntry.id, place: rootEntry.id, control: `scrollable #${scroller.index}`, detail: `wheel of 240px did not move a scrollable with ${scroller.scrollHeight - scroller.clientHeight}px of overflow`, evidence: [] });
      }
    }
  }
}

function rootsFrom(catalog) {
  const all = [
    ...catalog.sessions.map((s) => ({ id: `chat:${s.key}`, route: { kind: 'chat', key: s.key } })),
    ...catalog.places.map((p) => ({ id: `place:${p}`, route: { kind: 'place', place: p } })),
    ...catalog.settings.map((p) => ({ id: `settings:${p}`, route: { kind: 'settings', page: p } })),
  ];
  return config.rootFilter.length ? all.filter((r) => config.rootFilter.includes(r.id)) : all;
}

/** Turns each flagged node into one finding per problem, with the path that reproduces it. */
function findingsFromNodes(graph) {
  const out = [];
  for (const node of graph.nodes.values()) {
    if (node.status === 'skipped' || node.status === 'not-reached') continue;
    const observation = node.observation || {};
    const repro = [`open ${node.root}`, ...node.path.map((p) => `click ${p}`), `click ${node.label}`];
    const kinds = node.status === 'dead-end' ? ['dead-end', ...node.problems] : node.problems;
    for (const kind of kinds) {
      if (NOT_A_FINDING.has(kind)) continue;
      out.push({ kind, root: node.root, place: node.root, control: node.label, region: node.region, repro, timings: observation.timings, detail: observation.details || {}, evidence: observation.evidence || [] });
    }
  }
  return out;
}

function writePaths(graph, meta, findings) {
  const doc = {
    ...meta,
    coverage: graph.summary(),
    rootStats: meta.rootStats,
    nodes: [...graph.nodes.values()].map(({ observation, ...rest }) => ({ ...rest, timings: observation?.timings, evidence: observation?.evidence || [] })),
    edges: graph.edges,
    findingCount: findings.length,
  };
  writeFileSync(join(config.out, 'paths.json'), `${JSON.stringify(doc, null, 2)}\n`);
  const lines = [...findings, ...findingsFromNodes(graph)];
  writeFileSync(join(config.out, 'findings.jsonl'), lines.map((f) => JSON.stringify(f)).join('\n') + (lines.length ? '\n' : ''));
  return lines.length;
}

async function main() {
  for (const dir of ['', 'videos', 'traces', 'frames']) mkdirSync(join(config.out, dir), { recursive: true });
  const startedAt = Date.now();
  const vite = config.baseUrl ? null : startVite();
  const base = config.baseUrl || `http://127.0.0.1:${config.port}`;
  const harnessUrl = `${base}/scripts/button-crawl-harness.html`;
  let browser;
  try {
    await waitForUrl(harnessUrl);
    browser = await chromium.launch({ headless: true, args: config.chromeArgs, executablePath: env.FRAME_QA_CHROME_PATH || undefined });
    const probe = await browser.newPage();
    await probe.goto(harnessUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await probe.locator('[data-connection="ready"]').waitFor({ timeout: 30000 });
    const catalog = await probe.evaluate(() => window.__crawl.catalog());
    await probe.close();
    await runAll({ browser, harnessUrl, catalog, startedAt });
  } finally {
    await browser?.close().catch(() => undefined);
    stopVite(vite);
  }
}

async function runAll({ browser, harnessUrl, catalog, startedAt }) {
  const findings = [];
  const roots = rootsFrom(catalog);
  const graph = new VisitedGraph();
  const adapter = new HarnessAdapter({ browser, harnessUrl, out: config.out, findings });
  const meta = {
    os: config.os,
    harness: 'window/scripts/button-crawl-harness.html (fixture, mode A, no live engine)',
    startedAt: new Date(startedAt).toISOString(),
    budgetMinutes: config.budgetMs / 60000,
    maxDepth: config.maxDepth,
    roots: roots.map((r) => r.id),
  };
  const deadline = startedAt + config.budgetMs;
  let written = 0;
  const onNode = () => {
    written += 1;
    if (written % 25 === 0) writePaths(graph, { ...meta, rootStats: adapter.statsByRoot }, findings);
  };
  await traverse({ roots, adapter, graph, maxDepth: config.maxDepth, deadlineMs: deadline, onNode });
  const lines = writePaths(graph, { ...meta, rootStats: adapter.statsByRoot, finishedAt: new Date().toISOString(), budgetHit: Date.now() > deadline }, findings);
  console.log(`frame-qa ${config.os}: ${JSON.stringify(graph.summary())}, findings ${lines}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
