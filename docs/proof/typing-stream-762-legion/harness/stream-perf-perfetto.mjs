// Scratch (not committed): open the recorded Chrome trace in Perfetto UI and screenshot it.
import { chromium } from "playwright";
import { join } from "node:path";
const trace = process.env.TRACE; const out = process.env.OUT;
const browser = await chromium.launch({ headless: false, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--window-position=40,40", "--window-size=1700,1100"] });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();
  await page.goto("https://ui.perfetto.dev/", { waitUntil: "load" }); await page.waitForTimeout(4000);
  await page.locator("input[type=file]").first().setInputFiles(trace);
  await page.waitForTimeout(25000);
  await page.getByText("OK", { exact: true }).click().catch(() => {});
  for (const name of [/^Renderer \d+/, /^GPU Process \d+/]) await page.getByText(name).first().click().catch((e) => console.log("expand", String(e).slice(0, 80)));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, "perfetto-overview.png") });
  const main = page.getByText(/CrRendererMain/).first();
  await main.scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(1000);
  await page.screenshot({ path: join(out, "perfetto-renderer-main.png") });
  const text = await page.evaluate(() => document.body.innerText.slice(0, 3000));
  console.log(text.replace(/\s+/g, " ").slice(0, 1500));
} finally { await browser.close(); }
