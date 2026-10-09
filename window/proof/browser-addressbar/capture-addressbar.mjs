// Preview-only capture. Usage: node capture-addressbar.mjs <label>
import { chromium } from "/Volumes/512GB SSD/branch-wt/god-browser-addressbar/window/node_modules/playwright/index.mjs";
const label = process.argv[2];
const out = "/Users/taofikbishi/Library/Caches/claude-session-files/branch-god/browser-proof";
const browser = await chromium.launch({ headless: true });
const result = {};
try {
  const page = await browser.newPage({ viewport: { width: 940, height: 600 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:5179/test-integration/browser-addressbar-preview.html?state=started", { waitUntil: "load" });
  await page.waitForSelector(".br-addr-st", { timeout: 8000 }).catch(() => undefined);
  const addr = page.locator(".br-addr-st");
  result.addressExists = (await addr.count()) > 0;
  result.addressDisabled = result.addressExists ? await addr.isDisabled() : null;
  result.tabsBefore = await page.locator(".br-tab-st").count();
  await page.screenshot({ path: `${out}/${label}-1-started.png` });
  if (result.addressExists && !result.addressDisabled) {
    await addr.click();
    await page.keyboard.type("example.test/docs");
    result.valueAfterTyping = await addr.inputValue();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    result.tabsAfterEnter = await page.locator(".br-tab-st").count();
  } else {
    await page.keyboard.type("example.test/docs").catch(() => undefined);
    result.valueAfterTyping = result.addressExists ? await addr.inputValue() : null;
  }
  await page.screenshot({ path: `${out}/${label}-2-after-enter.png` });
  await page.locator('[aria-label="More browser actions"]').click({ timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${label}-3-more-menu.png` });
  result.pageErrors = errors;
  console.log(JSON.stringify({ label, ...result }));
} finally {
  await browser.close();
}
