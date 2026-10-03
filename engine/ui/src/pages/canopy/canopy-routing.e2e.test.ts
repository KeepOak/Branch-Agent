import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright";
import { expect, it } from "vitest";
import { createControlUiE2eSuite } from "../../e2e/control-ui-e2e-suite.test-support.ts";
import { createControlUiE2eArtifactDir } from "../../test-helpers/control-ui-e2e-artifacts.ts";
import { takeControlUiViewportScreenshot } from "../../test-helpers/control-ui-e2e-screenshot.ts";
import {
  controlUiE2eWaitTimeoutMs,
  installMockGateway,
  waitForControlUiRoute,
} from "../../test-helpers/control-ui-e2e.ts";
import { canopyUi } from "../../test-helpers/control-ui-canopy-fixture.ts";

const suite = createControlUiE2eSuite({
  name: "Control UI Canopy routing",
  unavailableMessage: (executablePath) =>
    `Playwright Chromium is not installed at ${executablePath}.`,
});

const captureUiProofEnabled = process.env.BRANCH_CAPTURE_UI_PROOF === "1";
const artifactParent = path.resolve(process.cwd(), ".artifacts/control-ui-e2e/canopy-routing");
const boards = [
  { id: "default", total: 0, active: 0, archived: 0, byStatus: {} },
  {
    id: "ops",
    name: "Operations",
    icon: "⚙",
    color: "#22c55e",
    total: 0,
    active: 0,
    archived: 0,
    byStatus: {},
  },
];

function configSnapshot(enabled: boolean) {
  const config = { plugins: { entries: { canopy: { enabled } } } };
  return {
    config,
    hash: `canopy-routing-${enabled}`,
    path: "/tmp/branch-e2e/branch.json",
    raw: JSON.stringify(config),
    resolved: config,
    sourceConfig: config,
  };
}

function sessionsListResponse() {
  return {
    count: 0,
    defaults: { contextTokens: null, model: null, modelProvider: null },
    path: "",
    sessions: [],
    ts: 1,
  };
}

async function newRecordedPage(
  artifactDir: string,
  label: string,
): Promise<{
  context: BrowserContext;
  page: Page;
  rawVideoDir: string;
}> {
  const rawVideoDir = path.join(artifactDir, `${label}-raw`);
  if (captureUiProofEnabled) {
    await mkdir(rawVideoDir, { recursive: true });
  }
  const context = await suite.browser.newContext({
    locale: "en-US",
    recordVideo: captureUiProofEnabled
      ? { dir: rawVideoDir, size: { width: 1600, height: 1000 } }
      : undefined,
    serviceWorkers: "block",
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(controlUiE2eWaitTimeoutMs);
  return { context, page, rawVideoDir };
}

async function closeRecordedPage(
  recorded: Awaited<ReturnType<typeof newRecordedPage>>,
  artifactDir: string,
  label: string,
) {
  const video = recorded.page.video();
  await recorded.context.close();
  if (video) {
    await copyFile(await video.path(), path.join(artifactDir, `${label}.webm`));
  }
  if (captureUiProofEnabled) {
    await rm(recorded.rawVideoDir, { force: true, recursive: true });
  }
}

suite.define(() => {
  it("routes, pins, persists, and normalizes Canopy boards", async () => {
    const artifactDir = captureUiProofEnabled
      ? createControlUiE2eArtifactDir("canopy-routing", artifactParent)
      : "";
    const recorded = await newRecordedPage(artifactDir, "routing");
    const { page } = recorded;
    try {
      await installMockGateway(page, {
        ...canopyUi,
        methodResponses: {
          "config.get": configSnapshot(true),
          "sessions.list": sessionsListResponse(),
          "canopy.boards.list": { boards },
          "canopy.cards.list": { boards, cards: [], statuses: ["todo", "done"] },
        },
      });

      const response = await page.goto(`${suite.server.baseUrl}canopy/ops?agent=main`);
      expect(response?.status()).toBe(200);
      await page.locator(".canopy-page-title", { hasText: "Operations" }).waitFor();
      const headerGlyph = page.locator(".canopy-board-glyph--header branch-appearance-glyph");
      await expect
        .poll(() => headerGlyph.evaluate((element) => element.shadowRoot?.textContent ?? ""))
        .toContain("⚙");
      await expect
        .poll(() => headerGlyph.evaluate((element) => getComputedStyle(element).color))
        .toBe("rgb(34, 197, 94)");
      const filterTrigger = page.locator(".canopy-filter-trigger");
      await filterTrigger.click();
      await page.getByRole("button", { name: /^Filter by board:/u }).waitFor();
      await filterTrigger.click();
      if (captureUiProofEnabled) {
        await writeFile(
          path.join(artifactDir, "01-board-route.png"),
          await takeControlUiViewportScreenshot(page, page.locator(".shell"), [headerGlyph]),
        );
      }

      const sidebar = page.locator("branch-app-sidebar");
      await sidebar.locator(".sidebar-nav__head-action").click();
      await sidebar
        .locator("wa-dropdown.sidebar-more-menu")
        .getByRole("menuitem", { name: "Edit pinned items" })
        .click();
      const customize = sidebar.locator(
        "wa-dropdown.sidebar-customize-menu:not(.sidebar-more-menu)",
      );
      await customize.getByRole("menuitemcheckbox", { name: /Operations/u }).click();
      const pinnedBoard = sidebar.locator('[data-sidebar-entry="plugin:canopy/board-ops"] a');
      await pinnedBoard.waitFor();
      expect(await pinnedBoard.getAttribute("href")).toBe("/canopy/ops");
      if (captureUiProofEnabled) {
        await writeFile(
          path.join(artifactDir, "02-pinned-board.png"),
          await takeControlUiViewportScreenshot(page, page.locator(".shell"), [pinnedBoard]),
        );
      }

      await page.goto(`${suite.server.baseUrl}canopy?board=ops&agent=main`);
      await waitForControlUiRoute(page, {
        pathname: "/canopy/ops",
        routeId: "canopy",
        search: "?agent=main",
      });
      expect(new URL(page.url()).searchParams.get("board")).toBeNull();
      expect(new URL(page.url()).searchParams.get("agent")).toBe("main");

      await page.reload();
      await sidebar.locator('[data-sidebar-entry="plugin:canopy/board-ops"] a').waitFor();
      await page.locator(".canopy-page-title", { hasText: "Operations" }).waitFor();
      if (captureUiProofEnabled) {
        await writeFile(
          path.join(artifactDir, "03-legacy-normalized-and-persisted.png"),
          await takeControlUiViewportScreenshot(page, page.locator(".shell"), [
            page.locator(".canopy-page-title", { hasText: "Operations" }),
          ]),
        );
      }

      const historyBeforeMissingBoard = await page.evaluate(() => history.length);
      await page.goto(`${suite.server.baseUrl}canopy/deleted?agent=main`);
      await waitForControlUiRoute(page, {
        pathname: "/canopy",
        routeId: "canopy",
        search: "?agent=main",
      });
      expect(new URL(page.url()).searchParams.get("agent")).toBe("main");
      await page.locator(".canopy-page-title", { hasText: "Canopy" }).waitFor();
      expect(await page.evaluate(() => history.length)).toBe(historyBeforeMissingBoard + 1);
    } finally {
      await closeRecordedPage(recorded, artifactDir, "routing");
    }
  });

  it("creates cards for the selected named agent without hiding them", async () => {
    await suite.withPage(
      {
        locale: "en-US",
        serviceWorkers: "block",
        viewport: { width: 1600, height: 1000 },
      },
      async ({ page }) => {
        const createdCard = {
          id: "writer-card",
          title: "Keep the writer task visible",
          status: "todo",
          priority: "normal",
          labels: [],
          agentId: "writer",
          position: 1000,
          createdAt: 1,
          updatedAt: 1,
        };

        const gateway = await installMockGateway(page, {
          ...canopyUi,
          methodResponses: {
            "agents.list": {
              defaultId: "main",
              mainKey: "main",
              scope: "agent",
              agents: [
                { id: "main", name: "Main" },
                { id: "writer", name: "Writer" },
              ],
            },
            "config.get": configSnapshot(true),
            "sessions.list": sessionsListResponse(),
            "canopy.boards.list": { boards },
            "canopy.cards.list": { boards, cards: [], statuses: ["todo", "done"] },
          },
        });
        await page.goto(`${suite.server.baseUrl}canopy`);
        await gateway.waitForRequest("agents.list");

        const agentScope = page.locator(".canopy-agent-filter branch-agent-select");
        await agentScope.locator(".agent-select__trigger").click();
        await expect
          .poll(() =>
            agentScope
              .locator("wa-dropdown-item[data-agent-option]")
              .filter({ hasText: "Main" })
              .evaluate((option) => option === document.activeElement),
          )
          .toBe(true);
        await agentScope
          .locator("wa-dropdown-item[data-agent-option]")
          .filter({ hasText: "Writer" })
          .click();
        await expect
          .poll(() =>
            agentScope.evaluate((select) => (select as HTMLElement & { value: string }).value),
          )
          .toBe("writer");
        await expect
          .poll(
            () =>
              agentScope.locator("wa-dropdown").evaluate((dropdown) => {
                const popup = dropdown.shadowRoot?.querySelector("wa-popup");
                return {
                  open: (dropdown as HTMLElement & { open: boolean }).open,
                  popupActive: Boolean(
                    (popup as (HTMLElement & { active: boolean }) | null)?.active,
                  ),
                };
              }),
            { timeout: 5_000 },
          )
          .toEqual({ open: false, popupActive: false });

        await gateway.deferNext("canopy.cards.create");
        await page.getByRole("button", { name: /New card/u }).click();

        const createForm = page.locator(".canopy-draft");
        await expect
          .poll(() =>
            createForm
              .locator(".canopy-agent-select branch-agent-select")
              .evaluate((select) => (select as HTMLElement & { value: string }).value),
          )
          .toBe("writer");
        await createForm.getByLabel("Title").fill(createdCard.title);
        await createForm.getByRole("button", { name: /^Create$/u }).click();

        const createRequest = await gateway.waitForRequest("canopy.cards.create");
        expect(createRequest.params).toMatchObject({
          agentId: "writer",
          title: createdCard.title,
        });
        await gateway.resolveDeferred("canopy.cards.create", { card: createdCard });

        await page.locator(".canopy-card", { hasText: createdCard.title }).waitFor({
          state: "visible",
        });
      },
    );
  });

  it("refreshes board navigation after browser Back retains an unfinished card draft", async () => {
    await suite.withPage(
      { serviceWorkers: "block", viewport: { width: 1600, height: 1000 } },
      async ({ page }) => {
        const gateway = await installMockGateway(page, {
          ...canopyUi,
          methodResponses: {
            "config.get": configSnapshot(true),
            "sessions.list": sessionsListResponse(),
            "canopy.boards.list": { boards },
            "canopy.cards.list": { boards, cards: [], statuses: ["todo", "done"] },
          },
        });
        await page.goto(`${suite.server.baseUrl}apps`);
        const sidebar = page.locator("branch-app-sidebar");
        await sidebar.locator(".sidebar-nav__head-action").click();
        await sidebar
          .locator("wa-dropdown.sidebar-more-menu")
          .getByRole("menuitem", { name: "Edit pinned items" })
          .click();
        await sidebar
          .locator("wa-dropdown.sidebar-customize-menu:not(.sidebar-more-menu)")
          .getByRole("menuitemcheckbox", { name: /Operations/u })
          .click();
        await page.keyboard.press("Escape");
        const pinnedBoard = sidebar.locator('[data-sidebar-entry="plugin:canopy/board-ops"] a');
        await pinnedBoard.click();
        await page.locator(".canopy-page-title", { hasText: "Operations" }).waitFor();
        await page.getByRole("button", { name: /New card/u }).click();
        await page.locator(".canopy-draft__title").fill("Keep this unfinished card");

        await page.goBack();
        await waitForControlUiRoute(page, { pathname: "/apps", routeId: "apps", search: "" });
        await page.locator(".canopy-draft").waitFor({ state: "detached" });
        const renamedBoards = boards.map((board) =>
          board.id === "ops" ? { ...board, name: "Renamed operations" } : board,
        );
        await gateway.setMethodResponse("canopy.cards.list", {
          boards: renamedBoards,
          cards: [],
          statuses: ["todo", "done"],
        });
        await gateway.setMethodResponse("canopy.boards.list", { boards: renamedBoards });
        await gateway.emitGatewayEvent("plugin.canopy.changed", {
          epoch: "canopy-draft-navigation",
          revision: 1,
        });
        await expect.poll(() => pinnedBoard.textContent()).toContain("Renamed operations");

        await page.goForward();
        await expect
          .poll(() => page.locator(".canopy-draft__title").inputValue())
          .toBe("Keep this unfinished card");
      },
    );
  });

  it("hides Canopy navigation while the plugin is inactive", async () => {
    await suite.withPage({ serviceWorkers: "block" }, async ({ page }) => {
      await installMockGateway(page, {
        nativePlugins: [],
        methodResponses: {
          "config.get": configSnapshot(false),
          "sessions.list": sessionsListResponse(),
          "canopy.boards.list": { boards },
        },
      });
      await page.goto(`${suite.server.baseUrl}chat`);
      const sidebar = page.locator("branch-app-sidebar");
      await sidebar.locator(".sidebar-nav__head-action").click();
      const moreMenu = sidebar.locator("wa-dropdown.sidebar-more-menu");
      await moreMenu.waitFor();
      expect(await moreMenu.getByText("Canopy", { exact: true }).count()).toBe(0);
      await moreMenu.getByRole("menuitem", { name: "Edit pinned items" }).click();
      const customize = sidebar.locator(
        "wa-dropdown.sidebar-customize-menu:not(.sidebar-more-menu)",
      );
      expect(await customize.getByText("Canopy", { exact: true }).count()).toBe(0);
      expect(await customize.locator('[value^="plugin:canopy/"]').count()).toBe(0);
    });
  });
});
