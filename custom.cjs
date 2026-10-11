
const C = require("./c6.cjs");
const fs = require("fs"); const path = require("path");
const FR = path.join(C.H, "frames"); const RES = path.join(C.H, "results.jsonl");
const shot = (page, n) => page.screenshot({ path: path.join(FR, n) });
const route = (page) => page.evaluate(() => localStorage.getItem("branch.route"));
const focus = (page) => page.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute("aria-label") || a.getAttribute("placeholder") || a.tagName) : ""; });
async function one(browser, id, root, fn) {
  const rec = { id, root, custom: true, at: new Date().toISOString() };
  const { context, page } = await C.newPage(browser, root);
  try { await fn(page, rec, context); } catch (e) { rec.error = String(e).split("\n")[0].slice(0, 200); }
  fs.appendFileSync(RES, JSON.stringify(rec) + "\n");
  console.log(JSON.stringify(rec).slice(0, 400));
  await context.close();
}
(async () => {
  const browser = await C.chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const R = "chat:agent:researcher:notes";
  await one(browser, "C6-042", R, async (page, rec) => {
    rec.label = "Back";
    rec.r0 = await route(page);
    await page.keyboard.press("Control+Comma"); await C.sleep(2000);
    rec.r1 = await route(page);
    await shot(page, "C6-042-before.png"); rec.before = "C6-042-before.png";
    await page.getByRole("button", { name: "Back", exact: true }).first().click(); await C.sleep(1800);
    rec.r2 = await route(page); rec.url = page.url();
    await shot(page, "C6-042-after.png"); rec.after = "C6-042-after.png";
    rec.found = true; rec.diff = rec.r1 !== rec.r2 ? ["route"] : [];
  });
  await one(browser, "C6-056", R, async (page, rec) => {
    rec.label = "Forward";
    await page.keyboard.press("Control+Comma"); await C.sleep(2000);
    await page.getByRole("button", { name: "Back", exact: true }).first().click(); await C.sleep(1500);
    rec.r1 = await route(page);
    await shot(page, "C6-056-before.png"); rec.before = "C6-056-before.png";
    await page.getByRole("button", { name: "Forward", exact: true }).first().click(); await C.sleep(1800);
    rec.r2 = await route(page);
    await shot(page, "C6-056-after.png"); rec.after = "C6-056-after.png";
    rec.found = true; rec.diff = rec.r1 !== rec.r2 ? ["route"] : [];
  });
  await one(browser, "C6-092", R, async (page, rec) => {
    rec.label = "Skip to the conversation";
    await page.getByRole("link", { name: "Skip to the conversation" }).first().focus(); await C.sleep(600);
    rec.f0 = await focus(page);
    await shot(page, "C6-092-before.png"); rec.before = "C6-092-before.png";
    await page.keyboard.press("Enter"); await C.sleep(1000);
    rec.f1 = await focus(page);
    await shot(page, "C6-092-after.png"); rec.after = "C6-092-after.png";
    rec.found = /Skip/.test(rec.f0); rec.diff = rec.f0 !== rec.f1 ? ["focus"] : [];
  });
  for (const [id, label] of []) {
    await one(browser, id, "place:canopy", async (page, rec) => {
      rec.label = label;
      const starts = page.getByRole("button", { name: "Start now" });
      rec.startNow = await starts.count();
      if (rec.startNow) { await starts.first().click().catch(() => {}); await C.sleep(6000); }
      rec.feed = (await page.locator("body").innerText()).match(/\d+ of \d+[^\n]*/)?.[0] || "";
      await shot(page, id + "-before.png"); rec.before = id + "-before.png";
      const A = await C.signature(page);
      await page.getByRole("button", { name: label, exact: true }).click(); await C.sleep(2000);
      const B = await C.signature(page);
      rec.diff = C.diff(A, B); rec.found = true;
      rec.feedAfter = (await page.locator("body").innerText()).match(/\d+ of \d+[^\n]*/)?.[0] || "";
      await shot(page, id + "-after.png"); rec.after = id + "-after.png";
    });
  }
  await browser.close();
})();