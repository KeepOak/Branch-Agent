import { expect, it } from "vitest";
import { createControlUiE2eSuite } from "../../e2e/control-ui-e2e-suite.test-support.ts";
import { installMockGateway } from "../../test-helpers/control-ui-e2e.ts";
import { canopyUi } from "../../test-helpers/control-ui-canopy-fixture.ts";
import {
  cardFitsWithinCanopyContent,
  createMobileScrollCards,
  expectedMobileScrollGeometry,
  readMobileScrollGeometry,
} from "./canopy-scroll.e2e.test-support.ts";

const suite = createControlUiE2eSuite({
  name: "Control UI Canopy mobile scroll E2E",
  unavailableMessage: (executablePath) =>
    `Playwright Chromium is not installed at ${executablePath}. Run \`pnpm --dir ui exec playwright install chromium\`, or set BRANCH_UI_E2E_ALLOW_MISSING_CHROMIUM=1 only when intentionally skipping this lane.`,
});

const baseTime = Date.parse("2026-06-01T18:00:00.000Z");

function canopyConfigSnapshot() {
  const config = { plugins: { entries: { canopy: { enabled: true } } } };
  return {
    config,
    hash: "canopy-mobile-scroll-e2e-config",
    path: "/tmp/branch-e2e/branch.json",
    raw: JSON.stringify(config),
    resolved: config,
    sourceConfig: config,
  };
}

suite.define(() => {
  it("scrolls every mobile column card into view while keeping the toolbar available", async () => {
    await suite.withPage({}, async ({ page }) => {
      const cards = createMobileScrollCards(baseTime);
      await page.setViewportSize({ height: 700, width: 390 });
      await installMockGateway(page, {
        ...canopyUi,
        methodResponses: {
          "config.get": canopyConfigSnapshot(),
          "sessions.list": {
            count: 0,
            defaults: { contextTokens: null, model: "gpt-5.5", modelProvider: "openai" },
            path: "",
            sessions: [],
            ts: baseTime,
          },
          "canopy.cards.list": {
            boards: [
              {
                id: "default",
                total: cards.length,
                active: cards.length,
                archived: 0,
                byStatus: {},
              },
            ],
            cards,
            statuses: [
              "triage",
              "backlog",
              "todo",
              "scheduled",
              "ready",
              "running",
              "review",
              "blocked",
              "done",
            ],
          },
        },
      });

      expect((await page.goto(`${suite.server.baseUrl}canopy`))?.status()).toBe(200);
      const content = page.locator(".content--canopy");
      const board = page.locator(".canopy-board");
      const columnCards = page.locator(".canopy-column--todo .canopy-column__cards");
      const toolbar = page.locator(".canopy-toolbar");
      const lastCard = page
        .locator(".canopy-column--todo .canopy-card", {
          hasText: "Mobile canopy card 6",
        })
        .first();
      await lastCard.waitFor({ state: "attached" });

      expect(await readMobileScrollGeometry(columnCards, "Mobile canopy card 6")).toEqual(
        expectedMobileScrollGeometry,
      );
      const initialToolbarTop = await toolbar.evaluate(
        (element) => element.getBoundingClientRect().top,
      );
      await columnCards.hover();
      for (let attempt = 0; attempt < 8; attempt += 1) {
        if (await cardFitsWithinCanopyContent(lastCard)) {
          break;
        }
        const previousScrollTop = await columnCards.evaluate((element) => element.scrollTop);
        await page.mouse.wheel(0, 320);
        await expect
          .poll(() => columnCards.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(previousScrollTop);
      }
      await expect
        .poll(() => columnCards.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      expect(await cardFitsWithinCanopyContent(lastCard)).toBe(true);
      expect(await toolbar.evaluate((element) => element.getBoundingClientRect().top)).toBeCloseTo(
        initialToolbarTop,
        0,
      );
      expect(await board.evaluate((element) => element.scrollTop)).toBe(0);
      expect(await content.evaluate((element) => element.scrollTop)).toBe(0);
    });
  });
});
