
const C = require("./c6.cjs");
const fs = require("fs"); const path = require("path");
const FR = path.join(C.H, "frames"); const RES = path.join(C.H, "results.jsonl");
const only = new Set(process.argv.slice(2));
async function ba(page, rec, loc, wait) {
  const t = loc.first();
  rec.ctl = await t.evaluate((e) => (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) + " {" + ["aria-pressed", "aria-checked", "aria-selected", "aria-expanded", "disabled"].filter((a) => e.hasAttribute(a)).map((a) => a + "=" + e.getAttribute(a)).join(",") + "}");
  await t.scrollIntoViewIfNeeded().catch(() => {});
  const A = await C.signature(page);
  await page.screenshot({ path: path.join(FR, rec.id + "-before.png") }); rec.before = rec.id + "-before.png";
  await t.click({ timeout: 5000 });
  await C.sleep(wait || 2500);
  const B = await C.signature(page);
  await page.screenshot({ path: path.join(FR, rec.id + "-after.png") }); rec.after = rec.id + "-after.png";
  rec.diff = C.diff(A, B); rec.found = true;
  rec.ctlAfter = await t.evaluate((e) => (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) + " {" + ["aria-pressed", "aria-checked", "aria-selected", "aria-expanded", "disabled"].filter((a) => e.hasAttribute(a)).map((a) => a + "=" + e.getAttribute(a)).join(",") + "}").catch(() => "gone");
  rec.toast = B.overlays.filter((x) => !A.overlays.includes(x)).slice(0, 2);
}
async function one(browser, id, root, label, fn) {
  if (only.size && !only.has(id)) return;
  const rec = { id, root, label, custom: true, at: new Date().toISOString() };
  const { context, page } = await C.newPage(browser, root);
  try { await fn(page, rec, context); } catch (e) { rec.error = String(e).split("\n")[0].slice(0, 200); }
  fs.appendFileSync(RES, JSON.stringify(rec) + "\n");
  console.log(JSON.stringify(rec).slice(0, 600));
  await context.close();
}
const R = "chat:agent:researcher:notes", P = "chat:agent:planner:design";
(async () => {
  const browser = await C.chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  for (const [id, root] of [["C6-041", R], ["C6-023", P], ["C6-009", "chat:agent:builder:roadmap"]]) await one(browser, id, root, "As set", async (page, rec) => {
    await page.getByRole("button", { name: /^Model, access and usage/ }).click(); await C.sleep(1200);
    const seg = page.locator("[aria-label='Steps sent as messages']").first();
    await seg.getByRole("radio", { name: "On" }).click(); await C.sleep(4000);
    rec.pre = "On";
    await ba(page, rec, seg.getByRole("radio", { name: "As set" }), 3000);
    await page.reload(); await page.getByText(/Taofiks_Legion/).first().waitFor({ timeout: 60000 }); await C.sleep(3000);
    await page.getByRole("button", { name: /^Model, access and usage/ }).click(); await C.sleep(1200);
    rec.persist = await page.locator("[aria-label='Steps sent as messages'] [role=radio]").evaluateAll((els) => els.map((e) => e.textContent.trim() + "=" + e.getAttribute("aria-checked")).join(" "));
  });
  await one(browser, "C6-074", R, "Next", async (page, rec) => {
    await page.keyboard.press("Control+KeyF"); await C.sleep(1000);
    await page.keyboard.type("audit"); await C.sleep(1500);
    await ba(page, rec, page.getByRole("button", { name: "Next", exact: true }), 1500);
  });
  await one(browser, "C6-082", R, "Play", async (page, rec) => {
    await page.getByRole("button", { name: "Conversation menu" }).click(); await C.sleep(800);
    await page.getByRole("menuitem", { name: /^Replay this conversation/ }).click(); await C.sleep(1500);
    await ba(page, rec, page.getByRole("button", { name: "Play", exact: true }), 4000);
  });
  await one(browser, "C6-114", "place:customize", "Trunks, 3", async (page, rec) => {
    await page.getByRole("tab", { name: /^Tools/ }).first().click(); await C.sleep(1500);
    rec.pre = "Tools";
    await ba(page, rec, page.getByRole("tab", { name: /^Trunks,/ }), 2000);
  });
  await one(browser, "C6-045", R, "Column", async (page, rec) => {
    await page.getByRole("button", { name: /^How threads show/ }).click(); await C.sleep(800);
    await page.getByRole("menuitemradio", { name: /Emoji rail/ }).or(page.getByRole("menuitem", { name: /Emoji rail/ })).first().click(); await C.sleep(1500);
    rec.pre = "Emoji rail";
    await page.getByRole("button", { name: /^How threads show/ }).click(); await C.sleep(800);
    await ba(page, rec, page.getByRole("menuitemradio", { name: /Column/ }).or(page.getByRole("menuitem", { name: /Column/ })), 2000);
    await page.reload(); await page.getByText(/Taofiks_Legion/).first().waitFor({ timeout: 60000 }); await C.sleep(3000);
    rec.persist = await page.getByRole("button", { name: /^How threads show/ }).first().getAttribute("aria-label").catch(() => "");
  });
  for (const [id, who] of [["C6-103", "Builder"], ["C6-105", "Planner"]]) await one(browser, id, R, "✓ " + who, async (page, rec) => {
    await page.getByRole("button", { name: "Conversation menu" }).click(); await C.sleep(800);
    await page.getByRole("menuitem", { name: /^Who Researcher knows/ }).click(); await C.sleep(1500);
    const item = page.locator("[role=menu] [role=menuitemcheckbox], [role=menu] [role=menuitem], [role=menu] button").filter({ hasText: new RegExp("^✓?\\s*" + who + "$") });
    rec.count = await item.count();
    await ba(page, rec, item, 3000);
    await page.reload(); await page.getByText(/Taofiks_Legion/).first().waitFor({ timeout: 60000 }); await C.sleep(3000);
    await page.getByRole("button", { name: "Conversation menu" }).click(); await C.sleep(800);
    await page.getByRole("menuitem", { name: /^Who Researcher knows/ }).click(); await C.sleep(1500);
    rec.persist = await page.locator("[role=menu]").last().innerText().then((t) => t.replace(/\s+/g, " ").slice(0, 200)).catch(() => "");
  });
  for (const [id, who] of [["C6-104", "Builder"], ["C6-106", "Planner"]]) await one(browser, id, R, "✓ " + who + " " + who + " may message Researcher", async (page, rec) => {
    await page.getByRole("button", { name: "Conversation menu" }).click(); await C.sleep(800);
    await page.getByRole("menuitem", { name: /^Who Researcher knows/ }).click(); await C.sleep(1500);
    const item = page.locator("[role=menu] [role=menuitemcheckbox]").filter({ hasText: who + " may message Researcher" });
    rec.count = await item.count();
    await ba(page, rec, item, 3000);
    await page.reload(); await page.getByText(/Taofiks_Legion/).first().waitFor({ timeout: 60000 }); await C.sleep(3000);
    await page.getByRole("button", { name: "Conversation menu" }).click(); await C.sleep(800);
    await page.getByRole("menuitem", { name: /^Who Researcher knows/ }).click(); await C.sleep(1500);
    rec.persist = await page.locator("[role=menu] [role=menuitemcheckbox]").filter({ hasText: who + " may message Researcher" }).first().getAttribute("aria-checked").catch(() => "");
  });
  await one(browser, "C6-201", "settings:instructions", "Reload", async (page, rec) => {
    await page.getByRole("button", { name: "Write", exact: true }).first().click(); await C.sleep(1500);
    await page.locator("textarea").first().fill("draft from the audit"); await C.sleep(500);
    fs.writeFileSync(path.join(C.H, "home", "ws-researcher", "SOUL.md"), "changed on disk " + Date.now() + "\n");
    await page.getByRole("button", { name: "Save", exact: true }).click(); await C.sleep(2500);
    rec.conflict = await page.getByText("Changed on this computer").isVisible().catch(() => false);
    await ba(page, rec, page.getByRole("button", { name: "Reload", exact: true }), 2500);
    rec.textarea = await page.locator("textarea").first().inputValue().catch(() => "");
  });
  await one(browser, "C6-229", "settings:notifications", "Pin On a locked screen", async (page, rec) => {
    const sw = page.getByRole("switch", { name: /Notifications on this computer/ });
    rec.swBefore = await sw.getAttribute("aria-checked").catch(() => "");
    await sw.click().catch(() => {}); await C.sleep(8000);
    rec.swAfter = await sw.getAttribute("aria-checked").catch(() => "");
    rec.lock = await page.getByText("On a locked screen").count();
    rec.page = (await page.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 600);
    await page.screenshot({ path: path.join(FR, "C6-229-before.png") }); rec.before = "C6-229-before.png";
  });
  await browser.close();
})();