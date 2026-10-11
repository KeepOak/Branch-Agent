
const C = require("./c6.cjs");
const fs = require("fs");
const LOGF = require("path").join(__dirname, "disc.log");
console.log = (...a) => require("fs").appendFileSync(LOGF, a.join(" ") + "\n");
const DANGER = /Delete|Remove|Archive|Start over|Pause|Restart|Sign out|Stop|Uninstall|Reset|Forget|Lockdown|Quit|Log out|Leave/i;

function chatOpeners(T) {
  const c = (name) => ({ click: name });
  const conv = c("Conversation menu");
  return {
    direct: [],
    convmenu: [conv],
    "conv>Export": [conv, c(/^Export/)],
    "conv>View": [conv, c(/^View/)],
    "conv>Snooze": [conv, c(/^Snooze/)],
    "conv>Share": [conv, c(/^Share this conversation/)],
    "conv>Replay": [conv, c(/^Replay this conversation/)],
    "conv>Map": [conv, c(/^Map of this conversation/)],
    "conv>Edit": [conv, c(new RegExp("^Edit " + T))],
    "conv>Who": [conv, c(new RegExp("^Who " + T + " knows"))],
    "conv>Move": [conv, c(/^Move to another computer/)],
    "tower>Who": [c(/^Who it knows$/)],
    model: [c(/^Model, access and usage/)],
    profile: [c(T + "’s profile")],
    "profile>Edit": [c(T + "’s profile"), c(new RegExp("^Edit " + T + "$"))],
    list: [c(/^Show the list/)],
    filter: [c(/^Show the list/), { testid: "filter-sort" }],
    "filter>trunk": [c(/^Show the list/), { testid: "filter-sort" }, { css: "[data-page=trunk]" }],
    "filter>group": [c(/^Show the list/), { testid: "filter-sort" }, { css: "[data-page=group]" }],
    "filter>sort": [c(/^Show the list/), { testid: "filter-sort" }, { css: "[data-page=sort]" }],
    "filter>hide": [c(/^Show the list/), { testid: "filter-sort" }, { css: "[data-page=hide]" }],
    owner: [c(/^Show the list/), c(/^Owner$/)],
    "owner>Shortcuts": [c(/^Show the list/), c(/^Owner$/), c(/^Keyboard shortcuts/)],
    shortcutsKey: [{ key: "Shift+Slash" }],
    newplaces: [c("New, places and more")],
    newlist: [c(/^Show the list/), c(/^New conversation, Trunk/)],
    attach: [c(/^Attach, mention a Trunk/)],
    tools: [c(/^Tools: connectors/)],
    threads: [c(/^How threads show/)],
    more: [c(/^More for /)],
    computer: [c(/· Online$/)],
    gateway: [c(/^Gateway ·/)],
    running: [c(/running · what/)],
    usage: [c(/^Usage ·/)],
  };
}

async function run(page, steps) {
  for (const s of steps) {
    if (s.click) await page.getByRole("button", { name: s.click }).or(page.getByRole("menuitem", { name: s.click })).or(page.getByRole("link", { name: s.click })).first().click({ timeout: 5000 });
    else if (s.testid) await page.getByTestId(s.testid).first().click({ timeout: 5000 });
    else if (s.css) await page.locator(s.css).first().click({ timeout: 5000 });
    else if (s.key) await page.keyboard.press(s.key);
    else if (s.menuitem) await page.locator("[role=menu] [role=menuitem], [role=menu] button").filter({ hasText: s.menuitem }).first().click({ timeout: 5000 });
    await C.sleep(900);
  }
}

(async () => {
  const roots = process.argv.slice(2);
  const browser = await C.chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const outFile = C.H + "/disc.json";
  const out = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, "utf8")) : {};
  for (const root of roots) {
    const T = root.startsWith("chat:") ? C.THREAD[root][0] : "";
    let openers = root.startsWith("chat:") ? chatOpeners(T) : { direct: [] };
    if (!root.startsWith("chat:")) {
      openers.list = [{ click: /^Show the list/ }];
    }
    out[root] = out[root] || {};
    const ctxs = [];
    for (const [name, steps] of Object.entries(openers)) {
      let page;
      try {
        while (ctxs.length) await ctxs.pop().close().catch(() => {}); const { context, page } = await C.newPage(browser, root); ctxs.push(context);
        await run(page, steps);
        out[root][name] = { steps: JSON.stringify(steps, (k, v) => (v instanceof RegExp ? "re:" + v.source : v)), names: await C.names(page) };
        console.log(root, name, out[root][name].names.length);
        // depth-2: expand each menu item of menu-like openers
        if (["convmenu", "newplaces", "owner", "newlist", "computer", "attach", "more", "profile"].includes(name)) {
          const items = await page.locator("[role=menu] [role=menuitem]:visible, [role=dialog] button:visible").evaluateAll((els) => els.map((e) => ({ t: (e.getAttribute("aria-label") || e.textContent || "").replace(/\s+/g, " ").trim(), d: e.disabled || e.getAttribute("aria-disabled") === "true", hp: e.getAttribute("aria-haspopup") })));
          for (const it of items) {
            if (!it.t || it.d || DANGER.test(it.t) || it.t.length > 60) continue;
            try {
              while (ctxs.length) await ctxs.pop().close().catch(() => {}); const { context, page } = await C.newPage(browser, root); ctxs.push(context);
              await run(page, steps);
              await page.locator("[role=menu] [role=menuitem]:visible, [role=dialog] button:visible").filter({ hasText: it.t }).first().click({ timeout: 4000 });
              await C.sleep(1200);
              const key = name + ">>" + it.t.slice(0, 40);
              out[root][key] = { steps: out[root][name].steps, item: it.t, names: await C.names(page) };
              console.log(root, key, out[root][key].names.length);
            } catch (e) { console.log(root, name, it.t, "FAIL", String(e).slice(0, 100)); }
          }
        }
      } catch (e) { console.log(root, name, "FAIL", String(e).split("\n")[0].slice(0, 160)); }
      fs.writeFileSync(outFile, JSON.stringify(out));
    }
    for (const c of ctxs) await c.close().catch(() => {});
  }
  await browser.close();
})();
