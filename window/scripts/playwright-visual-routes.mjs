// Captures the named screens of the visual harness with real clicks (Playwright, Chromium).
// Usage: node scripts/playwright-visual-routes.mjs <route> <outDir> [label]
//   routes: room-menu (a group room's ⋯ conversation menu), stage-preview (the side panel's Preview tab)
// The harness serves the fixture (group "Design group", portal "Ledger app"). Run the Vite server first:
//   npx vite --port 5751 --strictPort   and set VISUAL_URL=http://127.0.0.1:5751 (default below).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [route, outDir, label = "current"] = process.argv.slice(2);
const routes = ["room-menu", "stage-preview"];
if (!routes.includes(route) || !outDir) {
  console.error(`usage: node scripts/playwright-visual-routes.mjs <${routes.join("|")}> <outDir> [label]`);
  process.exit(2);
}
const base = process.env.VISUAL_URL ?? "http://127.0.0.1:5751";

async function openGroup(page) {
  await page.goto(`${base}/scripts/visual-harness.html`);
  await page.getByRole("button", { name: /^Design group/ }).first().click();
}

const steps = {
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
  const page = await browser.newPage({ viewport: { width: 1200, height: 1100 }, deviceScaleFactor: 2 });
  const target = await steps[route](page);
  await target.waitFor();
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${route}-${label}.png`);
  await target.screenshot({ path: file });
  console.log(file);
} finally {
  await browser.close();
}
