// Scratch (not committed): capture the approved preview's reply arrival for visual comparison.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const file = process.env.PREVIEW; const out = process.env.OUT; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: false, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--window-position=40,40", "--window-size=1280,900"] });
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, colorScheme: "light" });
  const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(file).href, { waitUntil: "load" }); await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, "preview-0-initial.png") });
  await page.getByText("Morning brief", { exact: true }).first().click(); await page.waitForTimeout(800);
  const frame = page.mainFrame();
  const box = page.locator("textarea:visible").first();
  await box.click(); await box.fill("Walk me through the full streaming pipeline, with code for every step.");
  const info = await page.evaluate(() => {
    window.__frames = []; let prev = 0; const t0 = performance.now();
    const tick = (t) => { if (prev) window.__frames.push(t - prev); prev = t; if (t - t0 < 2600) requestAnimationFrame(tick); };
    requestAnimationFrame(tick); return { chat: document.title };
  });
  await box.press("Enter");
  const start = Date.now();
  for (const [ms, name] of [[400, "preview-1-typing"], [1000, "preview-2-typing"], [1460, "preview-3-mid-rise"], [1950, "preview-4-settled"]]) {
    await page.waitForTimeout(Math.max(0, ms - (Date.now() - start)));
    await page.screenshot({ path: join(out, name + ".png") });
  }
  await page.waitForTimeout(900);
  const frames = await frame.evaluate(() => window.__frames.slice().sort((a, b) => a - b));
  const p = (q) => frames[Math.min(frames.length - 1, Math.ceil(q * frames.length) - 1)];
  const res = { ...info, frames: frames.length, medianMs: +p(0.5).toFixed(2), p95Ms: +p(0.95).toFixed(2), p99Ms: +p(0.99).toFixed(2), maxMs: +frames.at(-1).toFixed(2), errors };
  writeFileSync(join(out, "preview-result.json"), JSON.stringify(res, null, 2)); console.log(JSON.stringify(res));
} finally { await browser.close(); }
