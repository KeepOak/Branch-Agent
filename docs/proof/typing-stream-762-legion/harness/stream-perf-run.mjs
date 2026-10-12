// Scratch driver (not committed). Headed installed Chrome in the interactive desktop session.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const url = process.env.FIXTURE_URL; const out = process.env.OUT; const label = process.env.LABEL || "dev";
const chunk = Number(process.env.CHUNK || 55); const everyMs = Number(process.env.EVERY || 32);
const passes = Number(process.env.PASSES || 5); const record = process.env.RECORD === "1";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: false, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--window-position=40,40", "--window-size=1280,900"] });
const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, colorScheme: "light" });
  const page = await context.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  if (process.env.GPU === "1") {
    await page.goto("chrome://gpu"); await page.waitForTimeout(1500);
    const gpu = await page.evaluate(() => { const v = document.querySelector("info-view"); const root = v?.shadowRoot ?? document.body; return String(root.innerText ?? root.textContent ?? "").slice(0, 8000); }).catch((e) => String(e));
    writeFileSync(join(out, "chrome-gpu.txt"), gpu);
    await page.screenshot({ path: join(out, "chrome-gpu.png") });
  }
  if (process.env.SHOT_ONLY === "1") {
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => window.__fixture && document.querySelector("[data-testid=thread-scroll]"));
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(800);
    await page.screenshot({ path: join(out, "typing-start.png") });
    const pending = page.evaluate((o) => window.__fixture.start(o), { chunk, everyMs });
    await page.waitForTimeout(1200); await page.screenshot({ path: join(out, "early-stream.png") });
    await pending;
  }
  for (let i = 0; process.env.SHOT_ONLY !== "1" && i < passes + (record ? 1 : 0); i++) {
    const recorded = record && i === passes;
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(() => window.__fixture && document.querySelector("[data-testid=thread-scroll]"));
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(500);
    let cdp;
    if (recorded) {
      cdp = await context.newCDPSession(page);
      await cdp.send("Tracing.start", { transferMode: "ReturnAsStream", traceConfig: { recordMode: "recordUntilFull", includedCategories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "disabled-by-default-devtools.screenshot", "blink.user_timing", "latencyInfo", "loading", "v8.execute", "disabled-by-default-v8.cpu_profiler", "cc", "gpu", "viz", "benchmark", "toplevel"] } });
    }
    const pending = page.evaluate((o) => window.__fixture.start(o), { chunk, everyMs });
    if (i === 0 && !recorded) { await page.waitForTimeout(4000); await page.screenshot({ path: join(out, "mid-stream.png") }); }
    const r = await pending;
    if (recorded) {
      const done = new Promise((res) => cdp.once("Tracing.tracingComplete", res));
      await cdp.send("Tracing.end"); const { stream } = await done;
      let data = ""; for (;;) { const c = await cdp.send("IO.read", { handle: stream }); data += c.base64Encoded ? Buffer.from(c.data, "base64").toString() : c.data; if (c.eof) break; }
      await cdp.send("IO.close", { handle: stream });
      writeFileSync(join(out, "trace.json"), data);
    }
    await page.screenshot({ path: join(out, `pass-${i + 1}${recorded ? "-recorded" : ""}.png`) });
    results.push({ pass: i + 1, recorded, ...r });
    console.log(JSON.stringify({ pass: i + 1, recorded, medianMs: r.medianMs, p95Ms: r.p95Ms, p99Ms: r.p99Ms, maxMs: r.maxMs, frames: r.frames, longTasks: r.longTasksOver50.length }));
  }
  if (process.env.SHOT_ONLY !== "1") writeFileSync(join(out, `results-${label}.json`), JSON.stringify({ label, url, chunk, everyMs, errors, results }, null, 2));
} finally { await browser.close(); }
