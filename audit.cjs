
const C = require("./c6.cjs");
const fs = require("fs"); const path = require("path");
const LOGF = path.join(__dirname, "audit.log");
const log = (...a) => fs.appendFileSync(LOGF, new Date().toISOString().slice(11, 19) + " " + a.join(" ") + "\n");
const FR = path.join(C.H, "frames"); fs.mkdirSync(FR, { recursive: true });
const RES = path.join(C.H, "results.jsonl");

const inv = fs.readFileSync("C:/Users/bishi/AppData/Local/Temp/elm-c6/inventory.tsv", "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split("\t"));
const disc = JSON.parse(fs.readFileSync(path.join(C.H, "disc.json"), "utf8"));
const overrides = fs.existsSync(path.join(C.H, "overrides.json")) ? JSON.parse(fs.readFileSync(path.join(C.H, "overrides.json"), "utf8")) : {};

function revive(json) { return JSON.parse(json, (k, v) => (typeof v === "string" && v.startsWith("re:") ? new RegExp(v.slice(3)) : v)); }

function findOpener(root, label) {
  if (overrides[label + "@" + root]) return overrides[label + "@" + root];
  const d = disc[root] || {};
  const w = C.norm(label);
  const tests = [(n) => n === w, (n) => n.toLowerCase() === w.toLowerCase(), (n) => w.length >= 4 && n.startsWith(w)];
  for (const t of tests) for (const [k, v] of Object.entries(d)) if (v.names.some(t)) return { key: k, steps: v.steps, item: v.item };
  return null;
}

async function run(page, steps, item) {
  for (const s of revive(steps)) {
    if (s.click) await page.getByRole("button", { name: s.click }).or(page.getByRole("menuitem", { name: s.click })).or(page.getByRole("link", { name: s.click })).first().click({ timeout: 5000 });
    else if (s.testid) await page.getByTestId(s.testid).first().click({ timeout: 5000 });
    else if (s.css) await page.locator(s.css).first().click({ timeout: 5000 });
    else if (s.key) await page.keyboard.press(s.key);
    await C.sleep(900);
  }
  if (item) { await page.locator("[role=menu] [role=menuitem]:visible, [role=dialog] button:visible").filter({ hasText: item }).first().click({ timeout: 4000 }); await C.sleep(1200); }
}

async function targetState(page) {
  return page.evaluate(() => {
    const e = document.querySelector("[data-c6=target]");
    if (!e) return null;
    return ["aria-pressed", "aria-checked", "aria-expanded", "aria-selected", "aria-current", "disabled", "aria-disabled"].filter((a) => e.hasAttribute(a)).map((a) => a + "=" + e.getAttribute(a)).join(",") + "|" + (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
  });
}

(async () => {
  const want = new Set(process.argv.slice(2));
  const rows = inv.filter((r) => r[1] === "windows" && (want.size === 0 || want.has(r[0]) || want.has(r[2])));
  const browser = await C.chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  for (const [id, os, root, place, label] of rows) {
    const rec = { id, root, label, at: new Date().toISOString() };
    let context;
    try {
      const op = findOpener(root, label);
      rec.opener = op ? op.key : null;
      const np = await C.newPage(browser, (op && op.root) || root); rec.via = op && op.root; context = np.context; let page = np.page;
      if (op) await run(page, op.steps, op.item);
      const lab = (op && op.as) || label; rec.as = op && op.as;
      let m = await C.mark(page, lab, { prefix: op && op.prefix });
      if (!m) {
        // Not on the first view: try each tab on the page, then scroll to the end.
        const tabs = await page.locator("[role=tab]:visible").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().left >= 300 && e.getAttribute("aria-selected") !== "true").map((e) => (e.textContent || "").trim()).filter(Boolean));
        for (const t of tabs) {
          await page.locator("[role=tab]:visible").filter({ hasText: t }).first().click({ timeout: 3000 }).catch(() => {});
          await C.sleep(900);
          m = await C.mark(page, lab, { prefix: op && op.prefix });
          if (m) { rec.tab = t; break; }
        }
      }
      if (!m) {
        rec.found = false;
        await page.screenshot({ path: path.join(FR, id + "-before.png") });
        rec.before = id + "-before.png";
      } else {
        rec.found = true; rec.control = m;
        if (/aria-(selected|pressed|checked)=true|aria-current=(true|page)/.test(m.st)) {
          // Already chosen: pick a sibling first, so the click under test has something to change.
          const sib = await page.evaluate(() => {
            const t = document.querySelector("[data-c6=target]");
            const role = t.getAttribute("role");
            const attr = ["aria-selected", "aria-pressed", "aria-checked", "aria-current"].find((a) => t.hasAttribute(a));
            let p = t.parentElement;
            for (let i = 0; i < 4 && p; i++, p = p.parentElement) {
              const sibs = [...p.querySelectorAll(role ? "[role=" + role + "]" : "button[" + attr + "]")].filter((e) => e !== t && e.getClientRects().length && !e.disabled && e.getAttribute(attr) !== "true");
              if (sibs.length) { sibs[0].setAttribute("data-c6", "sib"); return (sibs[0].getAttribute("aria-label") || sibs[0].textContent || "").replace(/\s+/g, " ").trim().slice(0, 60); }
            }
            return null;
          });
          if (sib) {
            await page.locator("[data-c6=sib]").click({ timeout: 4000 }).catch(() => {});
            await C.sleep(1200);
            rec.preselect = sib;
            const m1 = await C.mark(page, lab);
            if (m1) rec.control = m1;
          }
        }
        const A = await C.signature(page);
        await page.locator("[data-c6=target]").scrollIntoViewIfNeeded().catch(() => {});
        await page.screenshot({ path: path.join(FR, id + "-before.png") });
        rec.before = id + "-before.png";
        const disabled = /(^|,)disabled=|aria-disabled=true/.test(rec.control.st);
        rec.disabled = disabled;
        const popups = [];
        context.__allowPages = true;
        const onPage = (p) => popups.push(p);
        context.on("page", onPage);
        if (!disabled) {
          await page.locator("[data-c6=target]").click({ timeout: 5000 }).catch(async (e) => { rec.clickErr = String(e).split("\n")[0].slice(0, 120); await page.locator("[data-c6=target]").click({ force: true, timeout: 3000 }).catch(() => {}); });
        } else {
          await page.locator("[data-c6=target]").hover({ timeout: 3000 }).catch(() => {});
        }
        await C.sleep(400);
        const early = await C.signature(page);
        await C.sleep(Number(process.env.C6_WAIT || 1100));
        context.off("page", onPage);
        rec.popups = [];
        for (const p of popups) { await p.waitForLoadState("domcontentloaded", { timeout: 4000 }).catch(() => {}); rec.popups.push(p.url().slice(0, 120)); await p.close({ runBeforeUnload: false }).catch(() => {}); }
        context.__allowPages = false;
        if (/\.\s*Change$/.test(label) && !disabled) {
          rec.capture = (await page.locator("[role=dialog]").first().innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 0);
          await page.screenshot({ path: path.join(FR, id + "-after.png") });
          await page.keyboard.press("Control+Alt+Shift+Digit9");
          await C.sleep(1200);
          await page.screenshot({ path: path.join(FR, id + "-after-set.png") });
        } else {
          await page.screenshot({ path: path.join(FR, id + "-after.png") });
        }
        rec.after = id + "-after.png";
        const B = await C.signature(page);
        rec.diff = C.diff(A, B);
        rec.early = C.diff(A, early);
        rec.toast = [...new Set([...early.overlays, ...B.overlays])].filter((x) => !A.overlays.includes(x)).slice(0, 3);
        rec.tAfter = await targetState(page);
        try { rec.clip = (await page.evaluate(() => navigator.clipboard.readText())).slice(0, 80); } catch {}
        const lsChanged = Object.keys(B.ls).filter((k) => A.ls[k] !== B.ls[k]);
        // persisted-state check: a fresh load of the same profile, then the same path back to the control
        page = await C.reopen(context, page);
        if (op) await run(page, op.steps, op.item).catch((e) => { rec.reopenErr = String(e).split("\n")[0].slice(0, 100); });
        if (rec.tab) await page.locator("[role=tab]:visible").filter({ hasText: rec.tab }).first().click({ timeout: 3000 }).catch(() => {});
        const m2 = await C.mark(page, lab, { prefix: op && op.prefix }) || (/\.\s*Change$/.test(label) ? await C.mark(page, label.split(":")[0]) : null);
        const R = await C.signature(page);
        rec.persist = { ls: lsChanged.map((k) => k + (R.ls[k] === B.ls[k] ? ":kept" : ":lost")), target: m2 ? m2.st + "|" + m2.name : null, before: rec.control.st + "|" + rec.control.name };
        await page.screenshot({ path: path.join(FR, id + "-reload.png") });
        rec.reload = id + "-reload.png";
      }
    } catch (e) {
      rec.error = String(e).split("\n")[0].slice(0, 200);
    }
    fs.appendFileSync(RES, JSON.stringify(rec) + "\n");
    log(id, label, rec.opener, rec.found, (rec.diff || []).join(","), rec.error || "");
    if (context) await context.close().catch(() => {});
  }
  await browser.close();
})();
