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
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { skipReason } from './denylist.mjs';
import { chooseRegion, chooseScreenClicks } from './targets.mjs';
import { classifyClick, elementKey, isNoise } from './observe.mjs';
import { inconsistentOpens, internalNameProblems, rowActionProblems } from './list-checks.mjs';
import { compareBaseline, formatGate, normalizeBaseline } from './baseline.mjs';
import { MAP_PATH, isInformationalStatus, isThreadLayoutMenu, previewDestinationMatches, readPreviewMap, threadLayoutDiff } from './preview-map.mjs';
import { markdownReport } from './report.mjs';
import { REQUEST_WAIT_CAP_MS, waitForPermissionRequests as waitForRequests } from './permission-wait.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const windowDir = resolve(root, 'window');
const require = createRequire(resolve(windowDir, 'package.json'));
const { chromium } = require('playwright');

const number = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const caps = {
  maxScreens: number('BUTTON_CRAWL_MAX_SCREENS', 48),
  maxPerScreen: number('BUTTON_CRAWL_MAX_PER_SCREEN', 28),
  maxClicks: number('BUTTON_CRAWL_MAX_CLICKS', 800),
  maxDepth: number('BUTTON_CRAWL_MAX_DEPTH', 1),
  maxOverlays: number('BUTTON_CRAWL_MAX_OVERLAYS', 8),
  maxChrome: number('BUTTON_CRAWL_MAX_CHROME', 20),
  maxNav: number('BUTTON_CRAWL_MAX_NAV', 48),
  maxSidebar: number('BUTTON_CRAWL_MAX_SIDEBAR', 40),
};

const port = number('BUTTON_CRAWL_PORT', 5653);
let harnessUrl = '';
const outDir = resolve(root, 'button-crawl-output');
const baselinePath = resolve(root, 'scripts/button-crawl/baseline.json');
const mapPath = process.env.BUTTON_CRAWL_MAP || resolve(root, MAP_PATH);

function signature(surface) {
  return [surface.route, surface.dialog, surface.menu, surface.panel, surface.toast, surface.mainText, surface.viewText, surface.control, surface.alert, surface.focus, surface.hash, surface.chrome, surface.historyMoves].join('\n');
}

function add(found, key, problems) {
  if (!problems.length) return;
  found[key] = [...new Set([...(found[key] || []), ...problems])].sort();
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
  const child = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
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

async function show(page, screen) {
  // A control can reload the harness page (the conversation menu's Reload). Wait until the harness is back.
  await page.waitForFunction(() => Boolean(window.__crawl), null, { timeout: 60000 });
  await page.evaluate((route) => window.__crawl.mount(route), screen.route);
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
  if (leftThePage && harnessUrl) await page.goto(harnessUrl, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => undefined);
  const consoleErrors = leftThePage ? [] : errors.slice(errorFrom).filter((line) => !isNoise(line));
  const failedCalls = (after.requests || []).slice(before.requestCount || 0).filter((call) => call && call.ok === false);
  return { before, after, elapsedMs, consoleErrors, failedCalls, requestTimedOut: requestWait.timedOut, ...classifyClick({ before, after, elapsedMs, consoleErrors, failedCalls }) };
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
  harnessUrl = `${base}/scripts/button-crawl-harness.html`;
  const errors = [];
  let browser;
  try {
    if (ownServer) await waitForUrl(`${base}/scripts/button-crawl-harness.html`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`${base}/scripts/button-crawl-harness.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.locator('[data-connection="ready"]').waitFor({ timeout: 30000 });
    const catalog = await page.evaluate(() => window.__crawl.catalog());
    const queue = [];
    for (const session of catalog.sessions) queue.push({ id: `chat:${session.key}`, route: { kind: 'chat', key: session.key }, depth: 0, path: [], listCheck: queue.length === 0 });
    for (const place of catalog.places) queue.push({ id: `place:${place}`, route: { kind: 'place', place }, depth: 0, path: [] });
    for (const settingsPage of catalog.settings) queue.push({ id: `settings:${settingsPage}`, route: { kind: 'settings', page: settingsPage }, depth: 0, path: [] });
    const found = {};
    const checks = [];
    const clicks = [];
    const skipped = [];
    let clickCount = 0;
    let overlays = 0;
    let screenCount = 0;
    const chromeNames = new Set();
    let sidebarDone = false;
    let navDone = false;
    while (queue.length && screenCount < caps.maxScreens) {
      const screen = queue.shift();
      screenCount += 1;
      const errorFrom = errors.length;
      const opened = await show(page, screen).catch((error) => {
        errors.push(String(error));
        return false;
      });
      if (!opened) {
        const openErrors = errors.slice(errorFrom).filter((line) => !isNoise(line));
        if (openErrors.length) add(found, elementKey(screen.id, '(open)'), ['console-error']);
        checks.push({ screenId: screen.id, complete: true, keys: openErrors.length ? [elementKey(screen.id, '(open)')] : [] });
        continue;
      }
      const openErrors = errors.slice(errorFrom).filter((line) => !isNoise(line));
      if (openErrors.length) add(found, elementKey(screen.id, '(open)'), ['console-error']);
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
      const room = Math.min(caps.maxPerScreen, Math.max(0, caps.maxClicks - clickCount));
      const chosen = ordered.slice(0, room);
      const shared = [];
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
        if (clickCount >= caps.maxClicks) break;
        await show(page, screen);
        const result = await clickOne(page, errors, el);
        if (!result) continue;
        clickCount += 1;
        const key = elementKey(screen.id, el.name);
        screenKeys.push(key);
        add(found, key, result.problems);
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
      checks.push({ screenId: screen.id, complete: chosen.length === wanted.length, keys: screenKeys });
    }
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
    const gate = compareBaseline({ baseline: baseline.problems || {}, found, checks });
    const report = {
      runtimeMs: Date.now() - startedAt,
      caps,
      screenCount,
      clickCount,
      skipped,
      gated: normalizeBaseline(found),
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
    const lines = formatGate(gate);
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
