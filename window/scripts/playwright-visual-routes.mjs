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
//   team-thread    the team proposal as a block in a Trunk's thread
// The fixture (visual-harness.tsx) supplies the group "Design group" and the portal "Ledger app".
// Writes <outDir>/<route>-<label>.png (label defaults to "current"); pass "before" or "after" for a PR.
// Add a route by adding a name in visual-routes.mjs and a step below.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { ROUTES } from "./visual-routes.mjs";

const [route, outDir, label = "current"] = process.argv.slice(2);
if (!(route in ROUTES) || !outDir) {
  console.error(
    `usage: node scripts/playwright-visual-routes.mjs <${Object.keys(ROUTES).join("|")}> <outDir> [label]`,
  );
  process.exit(2);
}
const base = process.env.VISUAL_URL ?? "http://127.0.0.1:5751";

async function openGroup(page) {
  await page.goto(`${base}/scripts/visual-harness.html`);
  await page
    .getByRole("button", { name: /^Design group/ })
    .first()
    .click();
}

const steps = {
  "team-approval-before": async (page) => {
    await openGroup(page);
    return page.locator("#root");
  },
  "team-thread": async (page) => {
    await page.goto(`${base}/scripts/visual-harness.html?thread=team`);
    return page.getByTestId("team-approval-card");
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
};

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 1100 },
    deviceScaleFactor: 2,
  });
  const target = await steps[route](page);
  await target.waitFor();
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${route}-${label}.png`);
  await target.screenshot({ path: file });
  console.log(file);
} finally {
  await browser.close();
}
