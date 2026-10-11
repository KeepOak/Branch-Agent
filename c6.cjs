
const fs = require("fs"); const path = require("path");
const { chromium } = require("C:/Users/bishi/Code/elm-496/window/node_modules/playwright");
const H = "C:/Users/bishi/AppData/Local/Temp/branch-selftest-elm496";
const token = fs.readFileSync(path.join(H, "token.txt"), "utf8").trim();
const norm = (s) => (s || "").replace(/\s+/g, "").replace(/[›…]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function baseState(root) {
  const st = JSON.parse(fs.readFileSync(path.join(H, "storage.base.json"), "utf8"));
  const ls = st.origins[0].localStorage.filter((x) => x.name !== "branch.route");
  if (root) ls.push({ name: "branch.route", value: JSON.stringify(routeFor(root)) });
  st.origins[0].localStorage = ls;
  return st;
}

async function openPage(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.setDefaultNavigationTimeout(60000);
  page.on("dialog", (d) => d.accept().catch(() => {}));
  await page.goto("http://127.0.0.1:5621/");
  await page.getByText(/Taofiks_Legion/).first().waitFor({ timeout: 120000, state: "attached" });
  await sleep(3000);
  return page;
}

async function newPage(browser, root) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState: baseState(root) });
  await context.grantPermissions(["clipboard-read", "clipboard-write", "notifications"], { origin: "http://127.0.0.1:5621" });
  if (!process.env.C6_NO_DESKTOP) await context.addInitScript(([gw, tok]) => { window.branchDesktop = { gatewayUrl: gw, gatewayToken: tok }; }, ["ws://127.0.0.1:19621", token]);
  context.on("page", (p) => { if (context.__main && p !== context.__main && !context.__allowPages) p.close({ runBeforeUnload: false }).catch(() => {}); });
  const page = await openPage(context);
  context.__main = page;
  return { context, page };
}

/** A fresh load of the window in the same profile: what was saved survives, what was only on screen does not. */
async function reopen(context, old) {
  if (old) await old.close({ runBeforeUnload: false }).catch(() => {});
  context.__allowPages = true;
  const page = await openPage(context);
  context.__allowPages = false;
  context.__main = page;
  return page;
}

const THREAD = { "chat:agent:researcher:notes": ["Researcher", "Notes"], "chat:agent:builder:roadmap": ["Builder", "Roadmap"], "chat:agent:planner:design": ["Planner", "Design"] };
const SETTINGS = { general: "General", people: "People", appearance: "Appearance", notifications: "Notifications", instructions: "Instructions & personality", models: "Models", local: "On this computer" };
const PLACES = { automations: "Automations", canopy: "Canopy", customize: "Customize", inbox: "Inbox", library: "Library", people: "People" };

function routeFor(root) {
  const [kind, ...rest] = root.split(":");
  if (kind === "chat") return { kind: "chat", key: rest.join(":") };
  if (kind === "place") return { kind: "place", place: rest[0] };
  return { kind: "settings", page: rest[0] };
}

/** Mark the best visible control whose name matches: overlays first, then the page body, then the side list. */
async function mark(page, label, opts) {
  return page.evaluate(([want, prefix]) => {
    const n = (s) => (s || "").replace(/\s+/g, "").replace(/[›…]/g, "");
    document.querySelectorAll("[data-c6=target]").forEach((e) => e.removeAttribute("data-c6"));
    const els = [...document.querySelectorAll("button, a, [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=switch], [role=tab], [role=radio], [role=option], [role=checkbox], input[type=checkbox], input[type=radio], summary, [tabindex]")]
      .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden");
    const rank = (e) => (e.closest("[role=dialog],[role=menu],[role=listbox],.pop,.menu") ? 0 : e.getBoundingClientRect().left >= 300 ? 1 : 2);
    els.sort((x, y) => rank(x) - rank(y));
    const names = (e) => [e.getAttribute("aria-label"), e.textContent, e.getAttribute("title"), (e.getAttribute("aria-label") || "") + (e.textContent || "")].map(n);
    const w = n(want);
    let hit = els.find((e) => names(e).includes(w));
    if (!hit) hit = els.find((e) => names(e).some((x) => x.toLowerCase() === w.toLowerCase()) && !/^Accent#/i.test(w));
    if (!hit && prefix) hit = els.find((e) => names(e).some((x) => x.length > 0 && x.startsWith(w)));
    if (!hit) return null;
    hit.setAttribute("data-c6", "target");
    const st = ["aria-pressed", "aria-checked", "aria-expanded", "aria-selected", "aria-current", "disabled", "aria-disabled"].filter((a) => hit.hasAttribute(a)).map((a) => a + "=" + hit.getAttribute(a)).join(",");
    return { tag: hit.tagName, role: hit.getAttribute("role"), name: (hit.getAttribute("aria-label") || hit.textContent || "").replace(/\s+/g, " ").trim().slice(0, 90), st, title: (hit.getAttribute("title") || "").slice(0, 120) };
  }, [label, Boolean(opts && opts.prefix)]);
}

async function names(page) {
  return page.evaluate(() => {
    const n = (s) => (s || "").replace(/\s+/g, "").replace(/[›…]/g, "");
    const els = [...document.querySelectorAll("button, a, [role=menuitem], [role=menuitemradio], [role=menuitemcheckbox], [role=switch], [role=tab], [role=radio], [role=option], [role=checkbox], input[type=checkbox], input[type=radio], summary, [tabindex]")]
      .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden");
    return [...new Set(els.flatMap((e) => [n(e.getAttribute("aria-label")), n(e.textContent), n(e.getAttribute("title"))]).filter(Boolean))];
  });
}

async function signature(page) {
  return page.evaluate(() => {
    const text = document.body.innerText.replace(/\s+/g, " ");
    const states = [...document.querySelectorAll("[aria-pressed],[aria-checked],[aria-expanded],[aria-selected],[aria-current],input,select,textarea")]
      .filter((e) => e.getClientRects().length > 0)
      .map((e) => (e.getAttribute("aria-label") || e.textContent || e.getAttribute("name") || "").trim().slice(0, 40) + "=" + [e.getAttribute("aria-pressed"), e.getAttribute("aria-checked"), e.getAttribute("aria-expanded"), e.getAttribute("aria-selected"), e.getAttribute("aria-current"), "value" in e ? e.value : "", e.checked].join("/"));
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!/device-(identity|token)/.test(k)) ls[k] = localStorage.getItem(k); }
    const overlays = [...document.querySelectorAll("[role=dialog],[role=menu],[role=alertdialog],[role=status],[role=alert],[role=tooltip],.toast")].filter((e) => e.getClientRects().length > 0).map((e) => (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100));
    const html = document.documentElement; const b = document.body;
    const look = [html.className, html.getAttribute("style") || "", html.dir, html.lang, html.getAttribute("data-theme") || "", b.className, b.getAttribute("style") || "", getComputedStyle(html).getPropertyValue("--accent")].join("|");
    const focus = document.activeElement ? (document.activeElement.getAttribute("aria-label") || document.activeElement.tagName) : "";
    return { text, states, ls, overlays, look, focus, url: location.href };
  });
}

function diff(a, b) {
  const out = [];
  if (a.text !== b.text) out.push("text");
  const sa = new Set(a.states), sb = new Set(b.states);
  const ch = [...sb].filter((x) => !sa.has(x));
  if (ch.length || a.states.length !== b.states.length) out.push("state:" + ch.slice(0, 3).join(";").slice(0, 160));
  const lsd = [...new Set([...Object.keys(a.ls), ...Object.keys(b.ls)])].filter((k) => a.ls[k] !== b.ls[k]);
  if (lsd.length) out.push("ls:" + lsd.join("+"));
  if (JSON.stringify(a.overlays) !== JSON.stringify(b.overlays)) out.push("overlay:" + b.overlays.filter((x) => !a.overlays.includes(x)).slice(0, 2).join(";").slice(0, 120));
  if (a.look !== b.look) out.push("look");
  if (a.url !== b.url) out.push("url");
  return out;
}

module.exports = { chromium, H, token, norm, sleep, newPage, reopen, routeFor, baseState, mark, names, signature, diff, THREAD, SETTINGS, PLACES };
