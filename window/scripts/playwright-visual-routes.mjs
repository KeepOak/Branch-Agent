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
//   computer-screen-before  the computer pane when its capture fails (main's JSON-RPC error)
//   computer-permission  the computer pane when the capture is all black (the Screen Recording ask)
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

// The computer pane: turn on screen access with a real click, then wait for the pane's note.
async function openComputer(page, state) {
  await page.goto(`${base}/scripts/visual-harness.html?computer=${state}`);
  await page.getByRole("button", { name: "See the screen and use the mouse" }).click();
  await page.locator(".pane-note[data-pane-state]").filter({ hasText: /screen/ }).first().waitFor();
  await page.waitForTimeout(300);
  return page.getByTestId("computer-preview");
}

const steps = {
  "computer-screen-before": async (page) => openComputer(page, "snapshot-error"),
  "computer-permission": async (page) => {
    const pane = await openComputer(page, "blank");
    await page.getByRole("button", { name: "Open System Settings" }).waitFor();
    return pane;
  },
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
  "steps-overflow": async (page) => {
    await page.goto(`${base}/scripts/visual-harness.html?overflow=steps`);
    return page.getByTestId("overflow-panel");
  },
  "pair-overflow": async (page) => {
    await page.setViewportSize({ width: 420, height: 900 });
    await page.goto(`${base}/scripts/visual-harness.html?overflow=pair`);
    await page.getByRole("button", { name: "Make the code" }).click();
    await page.getByText("Check that both screens show").waitFor();
    return page.getByRole("dialog", { name: "Pair a phone" });
  },
  "side-panel-tabs": async (page) => {
    await openGroup(page);
    await page.getByTestId("conversation-menu-button").click();
    await page.getByRole("menuitem", { name: /^Side panel/ }).click();
    await page.getByRole("tablist", { name: "Side panel views" }).waitFor();
    return page.getByRole("complementary", { name: "Side panel" });
  },
};

// Every element inside the box (the panel or the dialog) stays inside it, and the box and its scrolling body never
// scroll sideways. A long code or path that ran past the edge fails here.
const staysInside = (page, selector) => page.evaluate((selector) => {
  const box = document.querySelector(selector);
  if (!box) return [`${selector} isn't on the page`];
  const edge = box.getBoundingClientRect();
  const problems = [];
  for (const el of [box, ...box.querySelectorAll(".dlg-b, .r1c-steps-list, .r1c-step-detail")]) {
    if (el.scrollWidth > el.clientWidth + 1) problems.push(`${el.className || el.tagName} scrolls sideways: ${el.scrollWidth}px in ${el.clientWidth}px`);
  }
  for (const el of box.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;
    if (r.right > edge.right + 1 || r.left < edge.left - 1) {
      problems.push(`<${el.tagName.toLowerCase()} class="${el.className}"> runs past the edge: ${Math.round(r.left)}..${Math.round(r.right)} in ${Math.round(edge.left)}..${Math.round(edge.right)}`);
    }
  }
  return problems;
}, selector);

// Checks run after the screenshot, so a failing capture still leaves its picture. Each returns a list of problems.
const checks = {
  "steps-overflow": (page) => staysInside(page, '[data-testid="overflow-panel"]'),
  "pair-overflow": (page) => staysInside(page, '[role=dialog][aria-label="Pair a phone"]'),
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
