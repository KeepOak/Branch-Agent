// Clicks the window's controls from a fresh screen and gates the hard problems.
// Preview-map differences (PR #764) are written into the report and do not fail the job.
//
// Caps keep the pull-request job inside the 15 minute limit: every root screen is opened
// (each seeded conversation, each place, each settings page). Each screen clicks its own
// controls. Shared chrome, the sidebar, and the settings nav are clicked once, so they
// do not spend that screen budget. One overlay level (a menu or dialog) is opened from
// those clicks, with a cap.

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { skipReason } from './denylist.mjs';
import { chooseRegion, chooseScreenClicks } from './targets.mjs';
import { isPlusMoreRow } from './plus-more.mjs';
import { addConsoleEvidence, MAX_CONSOLE_PER_KEY } from './console-evidence.mjs';
import { classifyClick, elementKey, isNoise } from './observe.mjs';
import { inconsistentOpens, internalNameProblems, rowActionProblems } from './list-checks.mjs';
import { compareBaseline, formatGate, normalizeBaseline } from './baseline.mjs';
import { MAP_PATH, isInformationalStatus, isThreadLayoutMenu, previewDestinationMatches, readPreviewMap, threadLayoutDiff } from './preview-map.mjs';
import { markdownReport } from './report.mjs';
import { REQUEST_WAIT_CAP_MS, waitForPermissionRequests as waitForRequests } from './permission-wait.mjs';
import { viteLaunch } from './vite-launch.mjs';
import { SettingsTwins, twinSkips } from './twins.mjs';
import { NEVER_CLICKED_ALLOW, PageCoverage, neverKey } from './coverage.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const windowDir = resolve(root, 'window');
const require = createRequire(resolve(windowDir, 'package.json'));
const { chromium } = require('playwright');

const number = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

// R1 is the window every owner opens (the app default), so it is the default crawl and the CI gate. Classic is the
// escape window: it is crawled only with BUTTON_CRAWL_WINDOW=classic, against its own baseline.
const windowKind = process.env.BUTTON_CRAWL_WINDOW === 'classic' ? 'classic' : 'r1';
// Classic keeps the caps its baseline was built from; R1 gets the larger catalog.
const legacyCaps = windowKind === 'classic';
const caps = {
  maxScreens: number('BUTTON_CRAWL_MAX_SCREENS', legacyCaps ? 48 : 150),
  maxPerScreen: number('BUTTON_CRAWL_MAX_PER_SCREEN', legacyCaps ? 28 : 40),
  // Regular and Advanced Settings pages show a subset of the controls the Technical page of the same page shows. Their own
  // cap keeps the R1 crawl inside the CI time; a Settings page's levels share their clicks (coverage.mjs), so the
  // Technical level clicks what the other levels did not reach.
  maxPerScreenLevel: number('BUTTON_CRAWL_MAX_PER_SCREEN_LEVEL', legacyCaps ? 28 : 24),
  // The Technical level of a Settings page clicks every control the page has left: the largest page has 86 controls.
  maxPerSettingsPage: number('BUTTON_CRAWL_MAX_PER_SETTINGS_PAGE', legacyCaps ? 28 : 90),
  maxClicks: number('BUTTON_CRAWL_MAX_CLICKS', legacyCaps ? 800 : 2400),
  maxDepth: number('BUTTON_CRAWL_MAX_DEPTH', 1),
  maxOverlays: number('BUTTON_CRAWL_MAX_OVERLAYS', legacyCaps ? 8 : 40),
  maxChrome: number('BUTTON_CRAWL_MAX_CHROME', 20),
  maxNav: number('BUTTON_CRAWL_MAX_NAV', 48),
  maxSidebar: number('BUTTON_CRAWL_MAX_SIDEBAR', 40),
};

const port = number('BUTTON_CRAWL_PORT', 5653);
let harnessUrl = '';
const outDir = resolve(root, 'button-crawl-output');
const baselinePath = resolve(root, windowKind === 'classic' ? 'scripts/button-crawl/baseline-classic.json' : 'scripts/button-crawl/baseline.json');
// A Settings page at Regular or Advanced is its own screen (the level changes which rows show); Technical keeps the
// plain id, so the Technical keys of Classic and R1 read the same as before.
const settingsId = (page, level) => (level === 'technical' ? `settings:${page}` : `settings:${page}@${level}`);
const mapPath = process.env.BUTTON_CRAWL_MAP || resolve(root, MAP_PATH);

/** The click cap of one screen: Regular and Advanced Settings levels, the Technical Settings page, or any other screen. */
function settingsCap(screen) {
  if (screen.route.kind !== 'settings') return caps.maxPerScreen;
  if (screen.level === 'regular' || screen.level === 'advanced') return caps.maxPerScreenLevel;
  return caps.maxPerSettingsPage;
}

function signature(surface) {
  // Every field classifyClick reads as a result must change the signature, or a click whose only result is that field
  // waits out the full 450 ms and is then reported slow.
  return [surface.route, surface.dialog, surface.menu, surface.panel, surface.toast, surface.mainText, surface.viewText, surface.control, surface.alert, surface.focus, surface.hash, surface.chrome, surface.historyMoves, surface.popups, surface.downloads, surface.configRevision, surface.overlay, surface.values, surface.frame, surface.controlled].join('\n');
}

function add(found, key, problems) {
  if (!problems.length) return;
  found[key] = [...new Set([...(found[key] || []), ...problems])].sort();
}

function consoleShotFile(key) {
  const slug = String(key).replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'console-error';
  return `${slug}.jpg`;
}

function locationText(message) {
  try {
    const location = message.location();
    if (!location?.url) return '';
    const line = location.lineNumber ?? 0;
    const column = location.columnNumber ?? 0;
    return `${location.url}:${line}:${column}`;
  } catch {
    return '';
  }
}

async function readConsoleStack(message) {
  let args = [];
  try { args = message.args(); } catch { return ''; }
  const parts = [];
  try {
    for (const arg of args) {
      try {
        const stack = await arg.evaluate((value) => (value instanceof Error ? value.stack || '' : ''));
        if (stack) parts.push(stack);
      } catch { /* the page moved on; the text is already kept */ }
    }
  } finally {
    await Promise.all(args.map((arg) => arg.dispose().catch(() => undefined)));
  }
  return parts.join('\n');
}

async function releaseConsoleSource(entry) {
  const source = entry?.source;
  if (!source || typeof source.args !== 'function') return;
  delete entry.source;
  let args = [];
  try { args = source.args(); } catch { return; }
  await Promise.all(args.map((arg) => arg.dispose().catch(() => undefined)));
}

function pushThrown(errors, error) {
  if (error instanceof Error) {
    errors.push({
      text: error.message ? `${error.name}: ${error.message}` : String(error),
      stack: error.stack || '',
    });
    return;
  }
  errors.push({ text: String(error ?? ''), stack: '' });
}

// The listener only keeps the text. Stacks are read here, and only for the first messages
// the report will keep, so a noisy page cannot spend the crawl on handles it will drop.
async function drainErrors(errors, from) {
  const slice = errors.slice(from).filter((entry) => entry && !isNoise(entry.text));
  const enrich = slice.slice(0, MAX_CONSOLE_PER_KEY);
  await Promise.all(enrich.map(async (entry) => {
    if (!entry.source) return;
    const stack = await readConsoleStack(entry.source);
    delete entry.source;
    if (stack) entry.stack = stack;
  }));
  await Promise.all(errors.slice(from).map((entry) => releaseConsoleSource(entry)));
  return slice.map(({ text, stack }) => ({ text, stack: stack || '' }));
}

async function saveErrorShot(page, key) {
  const absolute = resolve(outDir, consoleShotFile(key));
  try {
    await page.screenshot({ path: absolute, type: 'jpeg', quality: 40 });
  } catch {
    return '';
  }
  const rel = relative(root, absolute).replaceAll('\\', '/');
  if (!rel || rel.startsWith('..') || rel.startsWith('/')) return '';
  return rel;
}

async function keepConsoleError(page, found, evidence, key, records) {
  const useful = (records || []).filter((record) => record?.text && !isNoise(record.text));
  if (!useful.length) return;
  add(found, key, ['console-error']);
  const screenshot = page ? await saveErrorShot(page, key) : '';
  addConsoleEvidence(evidence, key, useful, { root, screenshot });
}

async function waitForUrl(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
    } catch { /* the server is still starting */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`window did not answer on ${url}`);
}

function startVite() {
  const launch = viteLaunch(['--host', '127.0.0.1', '--port', String(port), '--strictPort'], require);
  const child = spawn(launch.command, launch.args, {
    cwd: windowDir,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let log = '';
  const keep = (chunk) => { log = (log + chunk.toString()).slice(-4000); };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  child.log = () => log;
  return child;
}

function stopVite(child) {
  if (!child || child.killed) return;
  try { process.kill(-child.pid, 'SIGTERM'); }
  catch { child.kill('SIGTERM'); }
}

// Each screen starts from a page load. The app keeps module-level state (look prefs, banners, the trunk host) that a
// remount does not reset, so one screen's clicks could change what the next screen shows. One reload per screen is
// cheaper than one per click (about 0.75 s each, which would push a full run past the 15 minute CI cap).
async function loadScreen(page) {
  await page.goto(harnessUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('[data-connection="ready"]').waitFor({ timeout: 30000 });
}

async function show(page, screen) {
  // A control can reload the harness page (the conversation menu's Reload). Wait until the harness is back.
  await page.waitForFunction(() => Boolean(window.__crawl), null, { timeout: 60000 });
  await page.evaluate((args) => window.__crawl.mount(args.route, args.level), { route: screen.route, level: screen.level || 'technical' });
  await page.locator('[data-connection="ready"]').waitFor({ timeout: 20000 });
  for (const step of screen.path || []) {
    const marked = await page.evaluate((target) => window.__crawl.mark(target.name, target.occurrence, target.region), step);
    if (!marked) return false;
    await page.evaluate(() => window.__crawl.clickTarget());
    await page.waitForTimeout(60);
  }
  return true;
}

// A click can start a permission-style request (the microphone, a notification prompt). Its
// result arrives after the click, so the click is classified once no such request is in flight.
// A request still pending after the cap is classified as is, and the crawl says so.


async function waitForPermissionRequests(page) {
  return waitForRequests({
    readPending: () => page.evaluate(() => window.__crawl.pendingPermissionRequests()),
    frames: (count) => page.evaluate((n) => new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(0); } };
      setTimeout(finish, 100 * n);
      const step = (left) => (left === 0 ? finish() : requestAnimationFrame(() => step(left - 1)));
      step(n);
    }), count),
    wait: (ms) => page.waitForTimeout(ms),
  });
}

async function clickOne(page, errors, target) {
  const marked = await page.evaluate((el) => window.__crawl.mark(el.name, el.occurrence, el.region), target);
  if (!marked) return null;
  const before = await page.evaluate(() => window.__crawl.surface());
  const errorFrom = errors.length;
  const started = Date.now();
  let after = before;
  let leftThePage = false;
  let requestWait = { timedOut: false, pending: 0 };
  let requestWaitMs = 0;
  try {
    await page.evaluate(() => window.__crawl.clickTarget());
    const waitStart = Date.now();
    requestWait = await waitForPermissionRequests(page);
    requestWaitMs = Date.now() - waitStart;
    if (requestWait.timedOut) process.stderr.write(`button-crawl: ${target.name} still had ${requestWait.pending} permission request(s) pending after ${REQUEST_WAIT_CAP_MS / 1000}s; classified as is\n`);
    for (;;) {
      after = await page.evaluate(() => window.__crawl.surface());
      if (signature(after) !== signature(before) || Date.now() - started > 450) break;
      await page.waitForTimeout(20);
    }
  } catch (error) {
    if (!/Execution context was destroyed|Navigation|Target closed|frame was detached/i.test(String(error))) throw error;
    leftThePage = true;
    after = { ...before, route: `${before.route || ''}#left` };
  }
  // The wait for a permission prompt is not UI latency, so it is left out of the elapsed time.
  const elapsedMs = Date.now() - started - requestWaitMs;
  // Read stacks before a recovery navigation replaces the page that logged them.
  const drained = await drainErrors(errors, errorFrom);
  if (leftThePage && harnessUrl) await page.goto(harnessUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
  // A navigation drops the page that logged the error, so those lines are not this click's.
  const consoleRecords = leftThePage ? [] : drained;
  const consoleErrors = consoleRecords.map((entry) => entry.text);
  const failedCalls = (after.requests || []).slice(before.requestCount || 0).filter((call) => call && call.ok === false);
  return { before, after, elapsedMs, consoleErrors, consoleRecords, failedCalls, requestTimedOut: requestWait.timedOut, ...classifyClick({ before, after, elapsedMs, consoleErrors, failedCalls }) };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const startedAt = Date.now();
  const previewMap = readPreviewMap(mapPath);
  const byLabel = new Map();
  for (const entry of previewMap.entries || []) {
    const key = entry.label.trim().toLowerCase().replace(/\s+/g, ' ');
    byLabel.set(key, [...(byLabel.get(key) || []), entry]);
  }
  const compared = new Set();
  const comparisons = [];
  let threadMenu = null;
  const ownServer = !process.env.BUTTON_CRAWL_URL;
  const vite = ownServer ? startVite() : null;
  const base = process.env.BUTTON_CRAWL_URL || `http://127.0.0.1:${port}`;
  harnessUrl = `${base}/scripts/button-crawl-harness.html?window=${windowKind}`;
  const errors = [];
  let browser;
  try {
    if (ownServer) await waitForUrl(`${base}/scripts/button-crawl-harness.html`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      let text = '';
      try { text = message.text(); } catch { text = ''; }
      errors.push({ text, stack: locationText(message), source: message });
    });
    page.on('pageerror', (error) => pushThrown(errors, error));
    await page.goto(harnessUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('[data-connection="ready"]').waitFor({ timeout: 30000 });
    const catalog = await page.evaluate(() => window.__crawl.catalog());
    const queue = [];
    for (const session of catalog.sessions) queue.push({ id: `chat:${session.key}`, route: { kind: 'chat', key: session.key }, depth: 0, path: [], listCheck: queue.length === 0 });
    for (const place of catalog.places) queue.push({ id: `place:${place}`, route: { kind: 'place', place }, depth: 0, path: [] });
    for (const entry of catalog.settings) queue.push({ id: settingsId(entry.page, entry.level), route: { kind: 'settings', page: entry.page }, level: entry.level, depth: 0, path: [] });
    const found = {};
    const consoleEvidence = {};
    const checks = [];
    const clicks = [];
    const skipped = [];
    const truncated = [];
    let clickCount = 0;
    let overlays = 0;
    let screenCount = 0;
    const chromeNames = new Set();
    let sidebarDone = false;
    let navDone = false;
    const settingsTwins = new SettingsTwins();
    const coverage = new PageCoverage();
    while (queue.length && screenCount < caps.maxScreens) {
      const screen = queue.shift();
      screenCount += 1;
      const errorFrom = errors.length;
      await loadScreen(page).catch((error) => pushThrown(errors, error));
      const opened = await show(page, screen).catch((error) => {
        pushThrown(errors, error);
        return false;
      });
      if (!opened) {
        const openErrors = await drainErrors(errors, errorFrom);
        const openKey = elementKey(screen.id, '(open)');
        await keepConsoleError(page, found, consoleEvidence, openKey, openErrors);
        checks.push({ screenId: screen.id, complete: true, keys: openErrors.length ? [openKey] : [] });
        continue;
      }
      const openErrors = await drainErrors(errors, errorFrom);
      if (openErrors.length) await keepConsoleError(page, found, consoleEvidence, elementKey(screen.id, '(open)'), openErrors);
      const shot = resolve(outDir, `${screen.id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'screen'}.jpg`);
      await page.screenshot({ path: shot, type: 'jpeg', quality: 40 }).catch(() => undefined);
      const keys = [];
      if (screen.listCheck) {
        const rows = await page.evaluate(() => window.__crawl.rowActions());
        const labels = await page.evaluate(() => window.__crawl.listLabels());
        for (const problem of rowActionProblems(rows)) {
          const key = elementKey('sidebar', problem.label);
          add(found, key, ['row-actions-inconsistent']);
          keys.push(key);
        }
        for (const row of rows) {
          const key = elementKey('sidebar', row.label);
          if (!keys.includes(key)) keys.push(key);
        }
        for (const label of internalNameProblems(labels)) add(found, elementKey('sidebar', label), ['internal-name-shown']);
        for (const label of labels) {
          const key = elementKey('sidebar', label);
          if (!keys.includes(key)) keys.push(key);
        }
        const opens = [];
        for (const row of rows.filter((item) => item.key).slice(0, 6)) {
          await show(page, screen);
          await page.evaluate((key) => {
            const button = document.querySelector(`[data-testid="conversation-row"][data-key="${CSS.escape(key)}"] .row-open`);
            button?.click();
          }, row.key);
          await page.waitForTimeout(80);
          const kind = await page.evaluate((key) => window.__crawl.openKind(key), row.key);
          opens.push({ label: row.label, kind });
        }
        for (const label of inconsistentOpens(opens)) add(found, elementKey('sidebar', label), ['inconsistent-open']);
        checks.push({ screenId: 'sidebar', complete: true, keys });
      }
      const elements = await page.evaluate((overlay) => window.__crawl.collect(overlay), screen.depth > 0);
      const pathNames = new Set((screen.path || []).map((step) => step.name));
      const skip = (el) => pathNames.has(el.name) || Boolean(skipReason(el)) || Boolean(el.selected);
      const wanted = chooseScreenClicks(elements, { limit: 10000, skip });
      const thread = wanted.find((el) => /how threads show|threads show as/i.test(el.name));
      const ordered = thread ? [thread, ...wanted.filter((el) => el !== thread)] : wanted;
      // A Settings page at a level whose controls are the same as a page already crawled (the same page at another level,
      // or the same rows) is not clicked again: the same controls ran there. The screen is still opened and named in the
      // report, and its keys stay out of the gate (no check is complete for it), so a change still shows on the first one.
      // A Settings page whose controls match a page that clicked all of its controls is a twin: it is not clicked again,
      // and each of its controls is listed in the report as the same as that page.
      const twinEligible = screen.route.kind === 'settings' && screen.depth === 0 && sidebarDone && navDone;
      const wantedNames = wanted.map((el) => el.name);
      const twin = twinEligible ? settingsTwins.twinOf(screen.route.page, wantedNames) : undefined;
      if (twin) {
        skipped.push(...twinSkips(screen.id, twin, wantedNames));
        checks.push({ screenId: screen.id, complete: false, keys: [] });
        continue;
      }
      const screenCap = settingsCap(screen);
      const room = Math.min(screenCap, Math.max(0, caps.maxClicks - clickCount));
      // A Settings page's levels share their controls (coverage.mjs): the room goes to controls no level has clicked yet.
      // Controls over the room are not clicked here; the report names them, and the gate names any no level clicks.
      const plan = screen.route.kind === 'settings'
        ? coverage.plan(screen.route.page, ordered, room)
        : { chosen: ordered.slice(0, room), beyond: ordered.slice(room).map((el) => el.name) };
      const chosen = plan.chosen;
      const chosenSet = new Set(chosen);
      if (plan.beyond.length) truncated.push({ screen: screen.id, notClicked: plan.beyond });
      const shared = [];
      let clickedAll = plan.beyond.length === 0;
      if (screen.depth === 0 && chromeNames.size < caps.maxChrome) {
        const fresh = chooseRegion(elements, 'chrome', {
          limit: caps.maxChrome - chromeNames.size,
          skip: (el) => skip(el) || chromeNames.has(el.name),
        });
        for (const el of fresh) chromeNames.add(el.name);
        shared.push(...fresh);
      }
      if (screen.depth === 0 && !sidebarDone) {
        sidebarDone = true;
        shared.push(...chooseRegion(elements, 'sidebar', { limit: caps.maxSidebar, skip }));
      }
      if (screen.depth === 0 && !navDone && elements.some((el) => el.region === 'nav')) {
        navDone = true;
        shared.push(...chooseRegion(elements, 'nav', { limit: caps.maxNav, skip }));
      }
      for (const el of elements) {
        if (pathNames.has(el.name)) continue;
        if (el.selected) {
          skipped.push({ screen: screen.id, label: el.name, reason: 'already-selected' });
          continue;
        }
        const reason = skipReason(el);
        if (reason) skipped.push({ screen: screen.id, label: el.name, reason });
      }
      const screenKeys = openErrors.length ? [elementKey(screen.id, '(open)')] : [];
      for (const el of [...chosen, ...shared]) {
        if (clickCount >= caps.maxClicks) { clickedAll = false; break; }
        await show(page, screen);
        const result = await clickOne(page, errors, el);
        if (!result) { clickedAll = false; continue; }
        clickCount += 1;
        if (screen.route.kind === 'settings' && chosenSet.has(el)) coverage.markClicked(screen.route.page, el.name);
        const key = elementKey(screen.id, el.name);
        screenKeys.push(key);
        add(found, key, result.problems);
        if (result.problems.includes('console-error')) await keepConsoleError(page, found, consoleEvidence, key, result.consoleRecords);
        clicks.push({ screen: screen.id, label: el.name, region: el.region, problems: result.problems, elapsedMs: result.elapsedMs, ledTo: result.ledTo, requests: result.requests });
        const labelKey = el.name.trim().toLowerCase().replace(/\s+/g, ' ');
        for (const entry of byLabel.get(labelKey) || []) {
          if (compared.has(entry.id) || isInformationalStatus(entry.status)) continue;
          compared.add(entry.id);
          comparisons.push({
            id: entry.id, screen: entry.screen, label: entry.label, previewAction: entry.previewAction, status: entry.status,
            match: previewDestinationMatches(entry.previewAction, { ...result.ledTo, dead: result.problems.includes('dead') }),
          });
        }
        if (!threadMenu && isThreadLayoutMenu(result.after.menu, el.name)) {
          threadMenu = { items: result.after.menuItems || [], ...threadLayoutDiff(result.after.menuItems || []) };
        }
        if (isPlusMoreRow(el, screen)) {
          queue.push({
            id: `${screen.id} > ${el.name}`,
            route: screen.route,
            depth: screen.depth + 1,
            path: [...(screen.path || []), { name: el.name, occurrence: el.occurrence, region: el.region }],
          });
        }
        const menuOpened = Boolean(result.after.menu) && result.after.menu !== result.before.menu;
        const dialogOpened = Boolean(result.after.dialog) && result.after.dialog !== result.before.dialog;
        const hasMenuItems = (result.after.menuItems || []).length > 0;
        if ((menuOpened || dialogOpened) && (dialogOpened || hasMenuItems) && screen.depth < caps.maxDepth && overlays < caps.maxOverlays) {
          overlays += 1;
          queue.push({
            id: `${screen.id} > ${el.name}`,
            route: screen.route,
            depth: screen.depth + 1,
            path: [...(screen.path || []), { name: el.name, occurrence: el.occurrence, region: el.region }],
          });
        }
      }
      if (twinEligible) settingsTwins.record(screen.route.page, wantedNames, screen.id, clickedAll);
      checks.push({ screenId: screen.id, complete: chosen.length === wanted.length, keys: screenKeys });
    }
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    const gate = compareBaseline({ baseline: baseline.problems || {}, found, checks });
    // A control that no level of its Settings page clicked fails the gate, unless it is in the reasoned allow list.
    const neverClicked = coverage.neverClicked();
    for (const item of neverClicked) {
      if (!NEVER_CLICKED_ALLOW[neverKey(item.page, item.name)]) gate.news.push({ key: neverKey(item.page, item.name), problem: 'never-clicked' });
    }
    if (gate.news.length) gate.ok = false;
    // Screens still queued when the screen cap was reached were never opened: that is missing coverage, not a pass.
    if (queue.length) gate.unvisited = queue.map((item) => item.id);
    if (queue.length) gate.ok = false;
    const report = {
      runtimeMs: Date.now() - startedAt,
      caps,
      screenCount,
      clickCount,
      unvisitedScreens: queue.map((item) => item.id),
      neverClicked,
      skipped,
      truncated,
      gated: normalizeBaseline(found),
      consoleEvidence,
      gate,
      clicks,
      previewMap: {
        loaded: previewMap.loaded,
        reason: previewMap.reason,
        entries: (previewMap.entries || []).length,
        counts: previewMap.counts || {},
        informational: previewMap.informational || [],
        comparisons,
      },
      threadMenu,
    };
    writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2));
    writeFileSync(resolve(outDir, 'report.md'), markdownReport(report));
    if (process.env.BUTTON_CRAWL_WRITE_BASELINE === '1') {
      writeFileSync(baselinePath, `${JSON.stringify({ version: 1, problems: normalizeBaseline(found) }, null, 2)}\n`);
      console.log(`wrote ${baselinePath}`);
    }
    const lines = formatGate(gate, consoleEvidence);
    for (const id of gate.unvisited || []) lines.push(`Screen not crawled (screen cap reached): ${id}`);
    console.log(markdownReport(report));
    if (!gate.ok && process.env.BUTTON_CRAWL_WRITE_BASELINE !== '1') {
      console.error(lines.join('\n'));
      process.exitCode = 1;
    }
  } catch (error) {
    if (vite) console.error(vite.log());
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
    stopVite(vite);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
