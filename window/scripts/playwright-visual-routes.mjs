// Captures a named screen of the visual harness with real clicks (Playwright, Chromium), and saves a screenshot.
//
// Usage (from window/, with the harness served by Vite):
//   npx vite --port 5751 --strictPort          # serve the harness
//   VISUAL_URL=http://127.0.0.1:5751 node scripts/playwright-visual-routes.mjs <route> <outDir> [label]
//
// Routes (names and descriptions in scripts/visual-routes.mjs):
//   room-menu      the group room's ⋯ conversation menu
//   stage-preview  the side panel's Preview tab with the Ledger app portal
//   team-approval-before  the group room, no team card (the before shot for the team card)
//   team-approval  the team proposal card, asking state
//   settings-nav-end  R1 Settings (Technical) under a 48 px bar, the nav scrolled to its end; fails if the last row is cut off
// The fixture (visual-harness.tsx) supplies the group "Design group" and the portal "Ledger app".
// Writes <outDir>/<route>-<label>.png (label defaults to "current"); pass "before" or "after" for a PR.
// Add a route by adding a name in visual-routes.mjs and a step below.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { ROUTES } from "./visual-routes.mjs";

const [route, outDir, label = "current"] = process.argv.slice(2);
if (!(route in ROUTES) || !outDir) {
  console.error(`usage: node scripts/playwright-visual-routes.mjs <${Object.keys(ROUTES).join("|")}> <outDir> [label]`);
  process.exit(2);
}
const base = process.env.VISUAL_URL ?? "http://127.0.0.1:5751";

async function openGroup(page) {
  await page.goto(`${base}/scripts/visual-harness.html`);
  await page.getByRole("button", { name: /^Design group/ }).first().click();
}

const steps = {
  "team-approval-before": async (page) => {
    await openGroup(page);
    return page.locator("#root");
  },
  "team-approval": async (page) => {
    await page.goto(`${base}/scripts/visual-harness.html?team=asking`);
    return page.getByTestId("team-approval-card");
  },
  "room-menu": async (page) => {
    await openGroup(page);
    await page.getByTestId("conversation-menu-button").click();
    return page.getByRole("menu", { name: "Conversation" });
  },
  "stage-preview": async (page) => {
    await openGroup(page);
    await page.getByTestId("conversation-menu-button").click();
    await page.getByRole("menuitem", { name: /^Side panel/ }).click();
    await page.getByRole("tab", { name: "Preview" }).click();
    await page.getByRole("region", { name: "Ledger app preview" }).waitFor();
    return page.getByRole("complementary", { name: "Side panel" });
  },
  "settings-nav-end": async (page) => {
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto(`${base}/scripts/visual-harness.html?settings=technical`);
    const side = page.locator(".r1s-side");
    await side.locator(".r1s-nav").last().waitFor();
    await page.waitForTimeout(500);
    await side.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(200);
    return page.locator("#root");
  },
  "side-panel-tabs": async (page) => {
    await openGroup(page);
    await page.getByTestId("conversation-menu-button").click();
    await page.getByRole("menuitem", { name: /^Side panel/ }).click();
    await page.getByRole("tablist", { name: "Side panel views" }).waitFor();
    return page.getByRole("complementary", { name: "Side panel" });
  },
};

// Checks run after the screenshot, so a failing capture still leaves its picture. Each returns a list of problems.
const checks = {
  "settings-nav-end": (page) => page.evaluate(() => {
    const frame = document.querySelector('[data-testid="settings-frame"]').getBoundingClientRect();
    const side = document.querySelector(".r1s-side");
    const rows = side.querySelectorAll(".r1s-nav");
    const last = rows[rows.length - 1];
    const problems = [];
    if (rows.length < 20) problems.push(`only ${rows.length} nav rows; the check needs a nav longer than the frame`);
    if (side.scrollHeight <= side.clientHeight) problems.push(`the nav does not scroll: ${side.scrollHeight}px of rows in ${side.clientHeight}px`);
    const sideBottom = side.getBoundingClientRect().bottom;
    if (sideBottom > frame.bottom + 1) problems.push(`the nav column ends at ${Math.round(sideBottom)}px, past the frame's ${Math.round(frame.bottom)}px bottom`);
    const lastBottom = last.getBoundingClientRect().bottom;
    if (lastBottom > frame.bottom + 1) problems.push(`the last nav row "${last.textContent.trim()}" ends at ${Math.round(lastBottom)}px, past the frame's ${Math.round(frame.bottom)}px bottom`);
    return problems;
  }),
  "side-panel-tabs": (page) => page.evaluate(() => {
    const row = document.querySelector('[role=tablist][aria-label="Side panel views"]');
    const rowBox = row.getBoundingClientRect();
    const problems = [];
    if (row.scrollWidth > row.clientWidth + 1) problems.push(`the tab row overflows: ${row.scrollWidth}px of tabs in ${row.clientWidth}px`);
    for (const el of row.querySelectorAll("[role=tab], .ptab-more-pn")) {
      const name = el.textContent.trim();
      if (el.getBoundingClientRect().right > rowBox.right + 1) problems.push(`"${name}" runs past the row`);
      if (el.scrollWidth > el.clientWidth + 1) problems.push(`"${name}" is clipped: ${el.scrollWidth}px of label in ${el.clientWidth}px`);
    }
    return problems;
  }),
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 }, deviceScaleFactor: 2 });
  const target = await steps[route](page);
  await target.waitFor();
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${route}-${label}.png`);
  await target.screenshot({ path: file });
  console.log(file);
  const problems = checks[route] ? await checks[route](page) : [];
  for (const problem of problems) console.error(`${route}: ${problem}`);
  if (problems.length) process.exitCode = 1;
} finally {
  await browser.close();
}
