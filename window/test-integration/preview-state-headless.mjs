// Component visual regression only; no installed-device or whole-app acceptance claim.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const url = process.env.PARITY_COMPONENT_URL;
if (!url) throw new Error("Set PARITY_COMPONENT_URL to test-integration/preview-state-render.html on the isolated Vite server.");
const out = process.env.PARITY_OUTPUT || "output/parity-component";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PARITY_CHROMIUM ? { executablePath: process.env.PARITY_CHROMIUM } : {}) });
const results = [];
try {
  for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 900, height: 450 }, colorScheme, reducedMotion: "reduce" });
    try {
      const page = await context.newPage(); const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url, { waitUntil: "load" });
      await page.locator('.character-panel-label i[data-state="wait"]').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      const fonts = await page.evaluate(() => [...document.fonts].filter(face => face.family === 'Geist' && face.status === 'loaded').map(face => face.weight));
      assert.ok(fonts.includes('400') && fonts.includes('600'));
      const dots = await page.locator('.character-panel-label i[data-state="wait"]').evaluateAll((els) => els.map(el => getComputedStyle(el).backgroundColor));
      const expected = colorScheme === "dark" ? "rgb(96, 100, 228)" : "rgb(72, 76, 229)";
      assert.deepEqual(dots, [expected, expected]);
      assert.equal(await page.locator('.character-panel-label small').first().innerText(), "Waiting for you");
      assert.equal(await page.locator('.pebble').count(), 1);
      assert.equal(await page.locator('.character-face').count(), 1);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: join(out, `waiting-${colorScheme}.png`) });
      results.push({ colorScheme, expected, dots, loadedGeistWeights: fonts, pageErrors: errors.length, result: "PASS" });
    } finally { await context.close(); }
  }
  writeFileSync(join(out, "waiting-colors.json"), JSON.stringify({ scope: "actual component render only", results }, null, 2));
  console.log(JSON.stringify(results));
} finally { await browser.close(); }
