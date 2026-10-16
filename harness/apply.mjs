// Copies the #1093 R1 Settings harness into a window/ dir (local only; not committed to the PRs).
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [win] = process.argv.slice(2);
const here = decodeURIComponent(new URL(".", import.meta.url).pathname);
copyFileSync(join(here, "visual-settings.html"), join(win, "scripts/visual-settings.html"));
copyFileSync(join(here, "visual-settings.tsx"), join(win, "scripts/visual-settings.tsx"));
const routesFile = join(win, "scripts/visual-routes.mjs");
let routes = readFileSync(routesFile, "utf8");
if (!routes.includes("settings-save-line")) {
  routes = routes.replace("export const ROUTES = {", `export const ROUTES = {
  "settings-save-line": "R1 Settings > Permissions (Technical), just after a choice is saved: the Saved line.",
  "settings-sent": "R1 Settings > Notifications (Technical), just after Send test: the Sent line in its row.",
  "settings-sent-idle": "R1 Settings > Notifications (Technical), the Send test row before anything is sent.",
  "settings-commands": "R1 Settings > Permissions (Technical), Access on Ask first: the commands defaults card.",
  "settings-card": "R1 Settings > Your card (Regular): the whole window.",
  "settings-hub": "R1 Settings > General (Regular): the other pages of General under their heading.",
  "settings-privacy-end": "R1 Settings > Privacy (Regular), scrolled to the end: the nav and the Town lookup card.",`);
  writeFileSync(routesFile, routes);
}
const runFile = join(win, "scripts/playwright-visual-routes.mjs");
let run = readFileSync(runFile, "utf8");
if (!run.includes("settings-save-line")) {
  run = run.replace("const steps = {", `const settingsAt = (page, at, level, extra = "") => page.goto(\`\${base}/scripts/visual-settings.html?page=\${at}&level=\${level}\${extra}\`);
const settle = (page) => page.waitForTimeout(800);
const sectionWith = (page, row) => page.locator(".sec").filter({ has: page.locator(\`[data-row="\${row}"]\`) }).first();
const steps = {
  "settings-save-line": async (page) => {
    await settingsAt(page, "permissions", "technical");
    const radio = page.locator('.r1s-classic [role="radio"]:not([aria-checked="true"]):not([disabled])').first();
    await radio.waitFor(); await settle(page);
    await radio.click();
    await page.locator(".r1s-classic-save").filter({ hasText: /Saved|Saving|Not saved/ }).waitFor({ state: "attached" });
    await page.waitForTimeout(150);
    return page.locator("#root");
  },
  "settings-sent": async (page) => {
    await settingsAt(page, "notifications", "technical");
    const row = page.locator('[data-row="Send a test notification"]').first();
    await row.waitFor(); await settle(page);
    await row.scrollIntoViewIfNeeded();
    await row.getByRole("button", { name: "Send test" }).click();
    await row.getByText(/Sent/).waitFor({ state: "attached" });
    await page.waitForTimeout(250);
    return sectionWith(page, "Send a test notification");
  },
  "settings-sent-idle": async (page) => {
    await settingsAt(page, "notifications", "technical");
    const row = page.locator('[data-row="Send a test notification"]').first();
    await row.waitFor(); await settle(page);
    await row.scrollIntoViewIfNeeded();
    return sectionWith(page, "Send a test notification");
  },
  "settings-commands": async (page) => {
    await settingsAt(page, "permissions", "technical", "&mode=ask");
    const sec = sectionWith(page, "Commands may run");
    await sec.waitFor(); await settle(page);
    await sec.scrollIntoViewIfNeeded();
    return sec;
  },
  "settings-card": async (page) => {
    await settingsAt(page, "card", "regular");
    await page.locator("main, #root").first().waitFor(); await page.waitForTimeout(1500);
    return page.locator("#root");
  },
  "settings-hub": async (page) => {
    await settingsAt(page, "general", "regular");
    await page.locator(".r1s-advanced").waitFor(); await settle(page);
    await page.locator(".r1s-advanced").scrollIntoViewIfNeeded();
    return page.locator("#root");
  },
  "settings-privacy-end": async (page) => {
    await settingsAt(page, "privacy", "regular");
    await page.locator(".r1s-side").first().waitFor(); await page.waitForTimeout(1500);
    await page.evaluate(() => { for (const el of document.querySelectorAll("*")) if (el.scrollHeight > el.clientHeight + 4 && getComputedStyle(el).overflowY.match(/auto|scroll/)) el.scrollTop = el.scrollHeight; window.scrollTo(0, document.body.scrollHeight); });
    await page.waitForTimeout(300);
    return page.locator("#root");
  },`);
  writeFileSync(runFile, run);
}
console.log("harness applied to", win);
