// Control UI tests cover canopy behavior.
import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  CanopyBoardSummary,
  CanopyCard,
  CanopyStatus,
} from "@branch/canopy-contract";
import type { BrowserContext, Locator, Page } from "playwright";
import { expect, it } from "vitest";
import { CANOPY_CHANGED_EVENT } from "../../../../packages/canopy-contract/src/index.js";
import { createRequireRecord } from "../../../../test/helpers/record.js";
import type { GatewaySessionRow } from "../../api/types.ts";
import { createControlUiE2eSuite } from "../../e2e/control-ui-e2e-suite.test-support.ts";
import { createControlUiE2eArtifactDir } from "../../test-helpers/control-ui-e2e-artifacts.ts";
import {
  takeControlUiViewportScreenshot,
  waitForControlUiProofSurface,
} from "../../test-helpers/control-ui-e2e-screenshot.ts";
import {
  controlUiE2eWaitTimeoutMs,
  installMockGateway,
  type MockGatewayControls,
  type MockGatewayRequest,
} from "../../test-helpers/control-ui-e2e.ts";
import { canopyUi } from "../../test-helpers/control-ui-canopy-fixture.ts";

const suite = createControlUiE2eSuite({
  name: "Control UI Canopy mocked Gateway E2E",
  unavailableMessage: (executablePath) =>
    `Playwright Chromium is not installed at ${executablePath}. Run \`pnpm --dir ui exec playwright install chromium\`, or set BRANCH_UI_E2E_ALLOW_MISSING_CHROMIUM=1 only when intentionally skipping this lane.`,
});

const captureUiProofEnabled = process.env.BRANCH_CAPTURE_UI_PROOF === "1";
const viewport = { height: 1000, width: 2400 };
const baseTime = Date.parse("2026-06-01T18:00:00.000Z");
const linkedSessionKey = "agent:main:canopy-proof";
const linkedSessionName = "Implementation session";
const CANOPY_STATUSES: readonly CanopyStatus[] = [
  "triage",
  "backlog",
  "todo",
  "scheduled",
  "ready",
  "running",
  "review",
  "blocked",
  "done",
];

type RecordedPage = {
  context: BrowserContext;
  page: Page;
  rawVideoDir: string;
};

type ProofArtifacts = {
  directory: string;
  screenshots: string[];
  videos: string[];
};

function createProofArtifacts(scope: string): ProofArtifacts {
  return {
    directory: captureUiProofEnabled ? createControlUiE2eArtifactDir(scope) : "",
    screenshots: [],
    videos: [],
  };
}

const requireRecord = createRequireRecord("record", "expected-object-value");

function requestParams(request: MockGatewayRequest): Record<string, unknown> {
  return requireRecord(request.params);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function openCanopyFilters(page: Page): Promise<void> {
  const trigger = page.locator(".canopy-filter-trigger");
  const panel = page.locator(".canopy-filter-popover__panel");
  if (!(await panel.isVisible())) {
    await trigger.click();
    await expect.poll(() => trigger.getAttribute("aria-expanded")).toBe("true");
  }
  await panel.waitFor({ state: "visible" });
}

async function chooseCanopyDisplayOption(page: Page, option: string) {
  await openCanopyFilters(page);
  await page
    .getByRole("group", { name: "Empty columns", exact: true })
    .getByRole("button", { name: option, exact: true })
    .click();
}

async function chooseCanopyBoard(page: Page, boardId: string) {
  await openCanopyFilters(page);
  const picker = page.locator("branch-select-picker").filter({
    has: page.getByRole("button", { name: /^Filter by board:/u }),
  });
  await picker.getByRole("button", { name: /^Filter by board:/u }).click();
  await picker.locator(`[role="option"][data-value="${boardId}"]`).click();
}

async function closeCanopyFilters(page: Page) {
  const popover = page.locator(".canopy-filter-popover");
  if (await page.locator(".canopy-filter-popover__panel").isVisible()) {
    await popover.evaluate((element) => {
      (element as HTMLElement).hidePopover();
    });
    await expect.poll(() => page.locator(".canopy-filter-popover__panel").isHidden()).toBe(true);
  }
}

async function setCanopyDraftField(
  scope: Page | Locator,
  label: string,
  value: string,
): Promise<void> {
  const input = scope.getByLabel(label);
  await input.fill(value);
  await expect.poll(() => input.inputValue()).toBe(value);
}

async function waitForRequests(
  gateway: MockGatewayControls,
  method: string,
  count: number,
): Promise<MockGatewayRequest[]> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const requests = await gateway.getRequests(method);
    if (requests.length >= count) {
      return requests;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  throw new Error(`Timed out waiting for ${count} ${method} requests`);
}

async function waitForNextRequest(
  gateway: MockGatewayControls,
  method: string,
  previousCount: number,
): Promise<MockGatewayRequest> {
  const requests = await waitForRequests(gateway, method, previousCount + 1);
  const request = requests.at(-1);
  if (!request) {
    throw new Error(`No ${method} request found`);
  }
  return request;
}

function canopyConfigSnapshot() {
  const config = {
    plugins: {
      entries: {
        canopy: { enabled: true },
      },
    },
  };
  return {
    config,
    hash: "canopy-e2e-config",
    path: "/tmp/branch-e2e/branch.json",
    raw: JSON.stringify(config, null, 2),
    resolved: config,
    sourceConfig: config,
  };
}

function sessionsListResponse(sessions: GatewaySessionRow[]) {
  return {
    count: sessions.length,
    defaults: {
      contextTokens: null,
      model: "gpt-5.5",
      modelProvider: "openai",
    },
    path: "",
    sessions,
    ts: baseTime,
  };
}

function sessionRow(overrides: Partial<GatewaySessionRow> = {}): GatewaySessionRow {
  return {
    contextTokens: 0,
    displayName: linkedSessionName,
    hasActiveRun: false,
    key: linkedSessionKey,
    kind: "direct",
    label: linkedSessionName,
    model: "gpt-5.5",
    modelProvider: "openai",
    totalTokens: 0,
    updatedAt: baseTime,
    ...overrides,
  };
}

function card(
  overrides: Partial<CanopyCard> & Pick<CanopyCard, "id" | "title">,
): CanopyCard {
  return {
    createdAt: baseTime,
    labels: [],
    notes: "",
    position: 1000,
    priority: "normal",
    status: "todo",
    updatedAt: baseTime,
    ...overrides,
  };
}

function cardsListResponse(
  cards: CanopyCard[],
  boards: CanopyBoardSummary[] = [
    { id: "default", total: cards.length, active: cards.length, archived: 0, byStatus: {} },
  ],
) {
  return {
    boards,
    cards,
    statuses: CANOPY_STATUSES,
  };
}

function statusColumn(page: Page, status: string) {
  const statusClass = status.trim().toLowerCase().replaceAll(/\s+/gu, "-");
  return page.locator(`.canopy-column--${statusClass}`).first();
}

function cardInColumn(page: Page, status: string, title: string) {
  return statusColumn(page, status).locator(".canopy-card", { hasText: title }).first();
}

async function clickCardAction(cardLocator: Locator, name: string) {
  await cardLocator.hover();
  await cardLocator.locator(".canopy-card__menu-trigger").click();
  await cardLocator.getByRole("button", { name, exact: true }).click();
}

async function newRecordedPage(
  artifacts: ProofArtifacts,
  label: string,
  options: { hasTouch?: boolean } = {},
): Promise<RecordedPage> {
  const rawVideoDir = path.join(artifacts.directory, `${label}-raw`);
  if (captureUiProofEnabled) {
    await mkdir(rawVideoDir, { recursive: true });
  }
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  try {
    context = await suite.browser.newContext({
      hasTouch: options.hasTouch,
      locale: "en-US",
      recordVideo: captureUiProofEnabled ? { dir: rawVideoDir, size: viewport } : undefined,
      serviceWorkers: "block",
      viewport,
    });
    page = await context.newPage();
    page.setDefaultTimeout(controlUiE2eWaitTimeoutMs);
    return { context, page, rawVideoDir };
  } catch (error) {
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    throw error;
  }
}

async function captureScreenshot(
  page: Page,
  artifacts: ProofArtifacts,
  name: string,
  surface = page.locator(".shell"),
  content: readonly Locator[] = [page.locator(".canopy-page-title")],
): Promise<void> {
  if (!captureUiProofEnabled) {
    return;
  }
  const screenshotPath = path.join(artifacts.directory, `${name}.png`);
  await writeFile(screenshotPath, await takeControlUiViewportScreenshot(page, surface, content));
  artifacts.screenshots.push(screenshotPath);
}

async function closeRecordedPage(
  recorded: RecordedPage,
  artifacts: ProofArtifacts,
  label: string,
): Promise<void> {
  const video = recorded.page.video();
  await recorded.context.close();
  if (!video) {
    return;
  }
  const rawVideoPath = await video.path();
  const videoPath = path.join(artifacts.directory, `${label}.webm`);
  await copyFile(rawVideoPath, videoPath);
  artifacts.videos.push(videoPath);
  // Preserve the raw recording if close or copy fails; only remove the retained copy's source.
  await rm(recorded.rawVideoDir, { force: true, recursive: true });
}

suite.define(() => {
  it("persists Canopy create, edit, running move, lifecycle sync, reload, and read-only state", async () => {
    const artifacts = createProofArtifacts("canopy-lifecycle");
    const createdCard = card({
      id: "card-1",
      labels: ["ui", "proof"],
      notes: "Acceptance: browser proof",
      sessionKey: linkedSessionKey,
      title: "Draft Canopy browser proof",
      updatedAt: baseTime + 1,
    });
    const editedCard = card({
      ...createdCard,
      labels: ["ui", "proof", "e2e"],
      notes: "Acceptance: mocked Gateway browser proof\nProof: pending",
      priority: "high",
      title: "Canopy browser proof",
      updatedAt: baseTime + 2,
    });
    const runningCard = card({
      ...editedCard,
      status: "running",
      updatedAt: baseTime + 3,
    });
    const reviewedCard = card({
      ...runningCard,
      events: [
        {
          at: baseTime + 4,
          fromStatus: "running",
          id: "event-review",
          kind: "moved",
          toStatus: "review",
        },
      ],
      status: "review",
      updatedAt: baseTime + 4,
    });
    const liveRefreshedCard = card({
      ...reviewedCard,
      notes: "Acceptance: live Gateway invalidation refreshed this card",
      title: "Canopy browser proof refreshed",
      updatedAt: baseTime + 5,
    });

    const writable = await newRecordedPage(artifacts, "canopy-writable");
    await writable.page.clock.install();
    try {
      const writableGateway = await installMockGateway(writable.page, {
        ...canopyUi,
        methodResponses: {
          "config.get": canopyConfigSnapshot(),
          "sessions.list": sessionsListResponse([sessionRow()]),
          "canopy.cards.list": cardsListResponse([]),
        },
      });
      const response = await writable.page.goto(`${suite.server.baseUrl}canopy`);
      expect(response?.status()).toBe(200);
      await writable.page
        .locator(".canopy-heading__actions")
        .getByRole("button", { name: /New card/u })
        .waitFor({ state: "visible" });
      await writableGateway.waitForRequest("canopy.cards.list");
      await expect.poll(() => writable.page.locator(".canopy-refresh").isEnabled()).toBe(true);
      expect(await writable.page.locator(".canopy-card").count()).toBe(0);
      await captureScreenshot(writable.page, artifacts, "01-empty-board");

      await openCanopyFilters(writable.page);
      const highPriority = writable.page
        .getByRole("group", { name: "Priority", exact: true })
        .getByRole("checkbox", { name: /High/u, disabled: false });
      await highPriority.press("Space");
      await expect.poll(() => highPriority.isChecked()).toBe(true);
      await highPriority.uncheck();
      await expect.poll(() => highPriority.isChecked()).toBe(false);
      await closeCanopyFilters(writable.page);

      await writableGateway.deferNext("canopy.cards.create");
      await writable.page
        .locator(".canopy-heading__actions")
        .getByRole("button", { name: /New card/u })
        .click();
      const createDialog = writable.page.getByRole("dialog", { name: "New card" });
      const createForm = writable.page.locator(".canopy-draft");
      await expect.poll(() => createDialog.isVisible()).toBe(true);
      await setCanopyDraftField(createForm, "Title", createdCard.title);
      await setCanopyDraftField(createForm, "Notes", createdCard.notes ?? "");
      await createForm.getByRole("button", { name: /^Session:/u }).click();
      await createForm
        .getByRole("option", { name: new RegExp(`^${escapeRegExp(linkedSessionName)}`, "u") })
        .click();
      await setCanopyDraftField(createForm, "Labels", "ui, proof");
      await captureScreenshot(writable.page, artifacts, "02-create-dialog", createDialog, [
        createForm.getByLabel("Title"),
        createForm.getByLabel("Notes"),
      ]);
      const createBefore = (await writableGateway.getRequests("canopy.cards.create")).length;
      await createForm.getByRole("button", { name: /^Create$/u }).click();
      const createRequest = await waitForNextRequest(
        writableGateway,
        "canopy.cards.create",
        createBefore,
      );
      expect(requestParams(createRequest)).toMatchObject({
        labels: ["ui", "proof"],
        notes: createdCard.notes,
        sessionKey: linkedSessionKey,
        status: "todo",
        title: createdCard.title,
      });
      expect(await createForm.getByLabel("Title").isDisabled()).toBe(true);
      expect(await createForm.getByLabel("Notes").isDisabled()).toBe(true);
      expect(await createForm.getByLabel("Labels").isDisabled()).toBe(true);
      expect(await createForm.getByRole("button", { name: /^Session:/u }).isDisabled()).toBe(true);
      expect(
        await createForm
          .getByRole("group", { name: "Status", exact: true })
          .getByRole("radio", { name: "Todo", exact: true })
          .isDisabled(),
      ).toBe(true);
      expect(
        await createForm
          .getByRole("group", { name: "Priority", exact: true })
          .getByRole("radio", { name: "Normal", exact: true })
          .isDisabled(),
      ).toBe(true);
      expect(
        await createForm.locator(".canopy-agent-select .agent-select__trigger").isDisabled(),
      ).toBe(true);
      const pendingCancelButtons = createForm.getByRole("button", {
        name: "Cancel",
        exact: true,
      });
      expect(await pendingCancelButtons.count()).toBe(2);
      expect(await pendingCancelButtons.first().isDisabled()).toBe(true);
      expect(await pendingCancelButtons.last().isDisabled()).toBe(true);
      expect(await createForm.locator(".canopy-template-strip button:disabled").count()).toBe(5);
      await writable.page.keyboard.press("Escape");
      await expect.poll(() => createDialog.isVisible()).toBe(true);
      await createDialog.click({ position: { x: 4, y: 4 } });
      await expect.poll(() => createDialog.isVisible()).toBe(true);
      await writableGateway.setMethodResponse(
        "canopy.cards.list",
        cardsListResponse([createdCard]),
      );
      await writableGateway.resolveDeferred("canopy.cards.create", { card: createdCard });
      await cardInColumn(writable.page, "Todo", createdCard.title).waitFor({ state: "visible" });
      await captureScreenshot(writable.page, artifacts, "03-created-card");

      await writableGateway.deferNext("canopy.cards.update");
      await clickCardAction(cardInColumn(writable.page, "Todo", createdCard.title), "Edit card");
      const editDialog = writable.page.getByRole("dialog", { name: "Edit card" });
      const editForm = writable.page.locator(".canopy-draft");
      await expect.poll(() => editDialog.isVisible()).toBe(true);
      await setCanopyDraftField(editForm, "Title", editedCard.title);
      await setCanopyDraftField(editForm, "Notes", editedCard.notes ?? "");
      const priority = editForm.getByRole("radio", { name: "High", exact: true, disabled: false });
      await priority.press("Space");
      expect(await priority.isChecked()).toBe(true);
      await setCanopyDraftField(editForm, "Labels", "ui, proof, e2e");
      const updateBeforeEdit = (await writableGateway.getRequests("canopy.cards.update")).length;
      await editForm.getByRole("button", { name: /^Save$/u }).click();
      const editRequest = await waitForNextRequest(
        writableGateway,
        "canopy.cards.update",
        updateBeforeEdit,
      );
      expect(requestParams(editRequest)).toEqual({
        id: createdCard.id,
        expectedUpdatedAt: createdCard.updatedAt,
        patch: {
          labels: ["ui", "proof", "e2e"],
          notes: editedCard.notes,
          priority: "high",
          title: editedCard.title,
        },
      });
      await writableGateway.setMethodResponse(
        "canopy.cards.list",
        cardsListResponse([editedCard]),
      );
      await writableGateway.resolveDeferred("canopy.cards.update", { card: editedCard });
      await cardInColumn(writable.page, "Todo", editedCard.title).waitFor({ state: "visible" });
      await captureScreenshot(writable.page, artifacts, "04-edited-card");

      await cardInColumn(writable.page, "Todo", editedCard.title).click();
      const details = writable.page.locator(".canopy-detail");
      await details.getByText(editedCard.title).waitFor({ state: "visible" });
      await details.getByText("Acceptance: mocked Gateway browser proof").waitFor({
        state: "visible",
      });
      await details.getByRole("button", { name: /^Status:/u }).waitFor({ state: "visible" });
      await details.locator("button[popovertarget=canopy-detail-actions]").click();
      expect(await details.getByRole("button", { name: "Open session" }).count()).toBe(1);
      expect(await details.getByRole("button", { name: "Edit card" }).count()).toBe(1);
      expect(await details.getByRole("button", { name: "Archive card" }).count()).toBe(1);
      expect(await details.getByRole("button", { name: "Delete card" }).count()).toBe(1);
      expect(await details.getByRole("button", { name: "Stop session" }).count()).toBe(0);
      await captureScreenshot(
        writable.page,
        artifacts,
        "05-detail-actions",
        writable.page.getByRole("dialog", { name: editedCard.title, exact: true }),
        [details.getByRole("button", { name: "Open session" })],
      );
      await details.locator('button[aria-label="Close"]').click();

      await writableGateway.deferNext("canopy.cards.move");
      const dragSource = cardInColumn(writable.page, "Todo", editedCard.title);
      await dragSource.dispatchEvent("dragstart");
      await expect
        .poll(() => dragSource.getAttribute("class"))
        .toContain("canopy-card--dragging");
      await expect
        .poll(() => dragSource.evaluate((element) => window.getComputedStyle(element).opacity))
        .toBe("0.45");
      expect(await writable.page.locator(".canopy-column--drop-target").count()).toBe(0);
      await statusColumn(writable.page, "Running").dispatchEvent("dragover");
      await expect
        .poll(() => writable.page.locator(".canopy-column--drop-target").count())
        .toBe(1);
      expect(await statusColumn(writable.page, "Running").getAttribute("class")).toContain(
        "canopy-column--drop-target",
      );
      await captureScreenshot(writable.page, artifacts, "06-drag-feedback");
      await dragSource.dispatchEvent("dragend");
      await expect
        .poll(() => dragSource.getAttribute("class"))
        .not.toContain("canopy-card--dragging");

      const moveBefore = (await writableGateway.getRequests("canopy.cards.move")).length;
      await dragSource.dragTo(statusColumn(writable.page, "Running"));
      const moveRequest = await waitForNextRequest(
        writableGateway,
        "canopy.cards.move",
        moveBefore,
      );
      expect(requestParams(moveRequest)).toMatchObject({
        id: editedCard.id,
        status: "running",
      });
      await writableGateway.setMethodResponse(
        "canopy.cards.list",
        cardsListResponse([runningCard]),
      );
      await writableGateway.resolveDeferred("canopy.cards.move", { card: runningCard });
      await cardInColumn(writable.page, "Running", editedCard.title).waitFor({
        state: "visible",
      });
      await captureScreenshot(writable.page, artifacts, "07-moved-running");

      const updateBeforeLifecycle = (await writableGateway.getRequests("canopy.cards.update"))
        .length;
      const sessionListBeforeSync = (await writableGateway.getRequests("sessions.list")).length;
      await writableGateway.setMethodResponse(
        "sessions.list",
        sessionsListResponse([
          sessionRow({ hasActiveRun: false, status: "done", updatedAt: baseTime + 4 }),
        ]),
      );
      await writableGateway.deferNext("sessions.list");
      await writableGateway.emitGatewayEvent("sessions.changed", {
        ...sessionRow({
          hasActiveRun: false,
          status: "done",
          updatedAt: baseTime + 4,
        }),
        reason: "lifecycle",
        sessionKey: linkedSessionKey,
        ts: baseTime + 4,
      });
      await waitForNextRequest(writableGateway, "sessions.list", sessionListBeforeSync);
      await writableGateway.resolveDeferred("sessions.list");
      await writable.page.waitForTimeout(250);
      expect(await writableGateway.getRequests("canopy.cards.update")).toHaveLength(
        updateBeforeLifecycle,
      );

      const listBeforeLifecycle = (await writableGateway.getRequests("canopy.cards.list"))
        .length;
      // Catalog and page refreshes read the same committed server state after the event.
      await writableGateway.setMethodResponse(
        "canopy.cards.list",
        cardsListResponse([reviewedCard]),
      );
      await writableGateway.deferNext("canopy.cards.list");
      await writableGateway.emitGatewayEvent(CANOPY_CHANGED_EVENT, {
        epoch: "canopy-e2e",
        revision: 1,
      });
      await waitForNextRequest(writableGateway, "canopy.cards.list", listBeforeLifecycle);
      await writableGateway.resolveDeferred("canopy.cards.list");
      const reviewedCardSurface = cardInColumn(writable.page, "Review", editedCard.title);
      await reviewedCardSurface.waitFor({ state: "visible" });
      await clickCardAction(reviewedCardSurface, "View details");
      await writable.page.getByRole("tab", { name: "Activity", exact: true }).click();
      await writable.page.locator(".canopy-detail").getByText("Moved to Review").waitFor({
        state: "visible",
      });
      await captureScreenshot(
        writable.page,
        artifacts,
        "08-lifecycle-review",
        writable.page.getByRole("dialog", { name: editedCard.title, exact: true }),
        [details.getByText("Moved to Review")],
      );
      await details.locator('button[aria-label="Close"]').click();
      await details.waitFor({ state: "hidden" });

      await clickCardAction(cardInColumn(writable.page, "Review", editedCard.title), "Edit card");
      await expect.poll(() => editDialog.isVisible()).toBe(true);
      const unsavedNotes = "Keep these unfinished Canopy notes";
      await setCanopyDraftField(editForm, "Notes", unsavedNotes);
      const listBeforeLiveRefresh = (await writableGateway.getRequests("canopy.cards.list"))
        .length;
      const liveRefreshResponse = cardsListResponse([liveRefreshedCard]);
      liveRefreshResponse.boards.push({
        id: "live",
        name: "Live metadata",
        total: 0,
        active: 0,
        archived: 0,
        byStatus: {},
      });
      await writableGateway.setMethodResponse("canopy.cards.list", liveRefreshResponse);
      await writableGateway.deferNext("canopy.cards.list");
      await writableGateway.emitGatewayEvent(CANOPY_CHANGED_EVENT, {
        epoch: "canopy-e2e",
        revision: 2,
      });
      await waitForNextRequest(writableGateway, "canopy.cards.list", listBeforeLiveRefresh);
      await writableGateway.resolveDeferred("canopy.cards.list");
      await expect
        .poll(() =>
          writable.page
            .getByRole("option", { name: /Live metadata/u, includeHidden: true })
            .count(),
        )
        .toBe(1);
      expect(await editForm.getByLabel("Notes").inputValue()).toBe(unsavedNotes);
      expect(
        await reviewedCardSurface.getByRole("heading", { includeHidden: true }).textContent(),
      ).toBe(reviewedCard.title);
      expect(
        await writable.page
          .getByRole("heading", { name: liveRefreshedCard.title, exact: true, includeHidden: true })
          .count(),
      ).toBe(0);
      const listBeforeDraftClose = (await writableGateway.getRequests("canopy.cards.list"))
        .length;
      await editForm
        .locator(":scope > .canopy-modal__actions")
        .getByRole("button", { name: "Cancel", exact: true })
        .click();
      await writable.page
        .locator(".canopy-discard")
        .getByRole("button", { name: "Discard", exact: true })
        .click();
      await waitForNextRequest(writableGateway, "canopy.cards.list", listBeforeDraftClose);
      await cardInColumn(writable.page, "Review", liveRefreshedCard.title).waitFor({
        state: "visible",
      });
      const listAfterLiveRefresh = (await writableGateway.getRequests("canopy.cards.list"))
        .length;
      await writable.page.clock.fastForward(1_250);
      expect(await writableGateway.getRequests("canopy.cards.list")).toHaveLength(
        listAfterLiveRefresh,
      );

      await writableGateway.deferNext("canopy.cards.list");
      const listBeforeReload = (await writableGateway.getRequests("canopy.cards.list")).length;
      await writable.page
        .locator(".canopy-heading__actions")
        .getByRole("button", { name: /^Refresh$/u })
        .click();
      await waitForNextRequest(writableGateway, "canopy.cards.list", listBeforeReload);
      await writableGateway.resolveDeferred("canopy.cards.list");
      await cardInColumn(writable.page, "Review", liveRefreshedCard.title).waitFor({
        state: "visible",
      });
      await captureScreenshot(writable.page, artifacts, "09-reloaded-review");
    } finally {
      await closeRecordedPage(writable, artifacts, "canopy-writable");
    }

    const readOnly = await newRecordedPage(artifacts, "canopy-read-only");
    try {
      const readOnlyGateway = await installMockGateway(readOnly.page, {
        ...canopyUi,
        operatorScopes: ["operator.read"],
        methodResponses: {
          "config.get": canopyConfigSnapshot(),
          "sessions.list": sessionsListResponse([
            sessionRow({ hasActiveRun: false, status: "done", updatedAt: baseTime + 4 }),
          ]),
          "canopy.cards.list": cardsListResponse([runningCard]),
        },
      });
      const response = await readOnly.page.goto(`${suite.server.baseUrl}canopy`);
      expect(response?.status()).toBe(200);
      await cardInColumn(readOnly.page, "Running", editedCard.title).waitFor({
        state: "visible",
      });
      await captureScreenshot(readOnly.page, artifacts, "09-read-only-board");
      expect(await readOnly.page.getByRole("button", { name: /New card/u }).count()).toBe(0);
      expect(await readOnly.page.locator('button[aria-label="Edit card"]').count()).toBe(0);
      expect(await readOnly.page.locator('button[aria-label="Delete card"]').count()).toBe(0);
      expect(await readOnly.page.locator('button[aria-label="Run default agent"]').count()).toBe(0);
      expect(
        await cardInColumn(readOnly.page, "Running", editedCard.title).getAttribute("draggable"),
      ).toBe("false");

      await cardInColumn(readOnly.page, "Running", editedCard.title).click();
      await readOnly.page.locator(".canopy-detail").getByText(editedCard.title).waitFor({
        state: "visible",
      });
      const readOnlyDetail = readOnly.page.locator(".canopy-detail");
      expect(await readOnlyDetail.getByRole("button", { name: /^Status:/u }).count()).toBe(0);
      expect(await readOnlyDetail.getByRole("button", { name: "Edit card" }).count()).toBe(0);
      expect(await readOnlyDetail.getByRole("button", { name: "Archive card" }).count()).toBe(0);
      expect(await readOnlyDetail.getByRole("button", { name: "Delete card" }).count()).toBe(0);
      expect(await readOnly.page.locator(".canopy-detail__note").count()).toBe(0);
      expect(await readOnly.page.getByRole("button", { name: /Add note/u }).count()).toBe(0);
      expect(await readOnlyGateway.getRequests("canopy.cards.update")).toHaveLength(0);
      expect(await readOnlyGateway.getRequests("canopy.cards.move")).toHaveLength(0);
      expect(await readOnlyGateway.getRequests("canopy.cards.create")).toHaveLength(0);
    } finally {
      await closeRecordedPage(readOnly, artifacts, "canopy-read-only");
    }

    if (captureUiProofEnabled) {
      await writeFile(
        path.join(artifacts.directory, "manifest.json"),
        `${JSON.stringify(artifacts, null, 2)}\n`,
        "utf-8",
      );
    }
  });

  it("keeps card titles visible when a column overflows its height", async () => {
    const artifacts = createProofArtifacts("canopy-overflow");
    const crowdedColumnCardCount = 8;
    const overflowTitle = (index: number) =>
      `Overflowing backlog card ${index + 1} with a long title that wraps onto two lines`;
    const crowdedCards = Array.from({ length: crowdedColumnCardCount }, (_, index) =>
      card({
        id: `overflow-card-${index + 1}`,
        notes: "Acceptance: title stays visible while the column scrolls.",
        position: 1000 + index,
        status: "todo",
        title: overflowTitle(index),
        updatedAt: baseTime + index,
      }),
    );

    const recorded = await newRecordedPage(artifacts, "canopy-overflow");
    try {
      await installMockGateway(recorded.page, {
        ...canopyUi,
        methodResponses: {
          "config.get": canopyConfigSnapshot(),
          "sessions.list": sessionsListResponse([sessionRow()]),
          "canopy.cards.list": cardsListResponse(crowdedCards),
        },
      });
      // Constrain the height so the Todo column must overflow its visible area.
      await recorded.page.setViewportSize({ height: 720, width: 1400 });
      const response = await recorded.page.goto(`${suite.server.baseUrl}canopy`);
      expect(response?.status()).toBe(200);
      const column = statusColumn(recorded.page, "Todo");
      await column.waitFor({ state: "visible" });
      await cardInColumn(recorded.page, "Todo", overflowTitle(0)).waitFor({ state: "visible" });
      await captureScreenshot(recorded.page, artifacts, "09-overflow-column");

      const titleHeights = await column
        .locator(".canopy-card h3")
        .evaluateAll((titles) => titles.map((title) => title.getBoundingClientRect().height));
      expect(titleHeights).toHaveLength(crowdedColumnCardCount);
      for (const height of titleHeights) {
        // Squeezed implicit grid rows previously collapsed the line-clamped title to 0px.
        expect(height).toBeGreaterThan(0);
      }

      const columnScrolls = await column
        .locator(".canopy-column__cards")
        .evaluate((cards) => cards.scrollHeight > cards.clientHeight + 1);
      expect(columnScrolls).toBe(true);
    } finally {
      await closeRecordedPage(recorded, artifacts, "canopy-overflow");
    }
  });

  it("collapses empty stages into rails without squeezing active columns", async () => {
    const artifacts = createProofArtifacts("canopy-collapsed-columns");
    const reviewCard = card({
      id: "review-card",
      status: "review",
      title: "Review the completed implementation",
    });
    const doneCard = card({
      id: "done-card",
      status: "done",
      title: "Previously completed work",
    });
    const recorded = await newRecordedPage(artifacts, "canopy-collapsed-columns");
    try {
      const gateway = await installMockGateway(recorded.page, {
        ...canopyUi,
        methodResponses: {
          "config.get": canopyConfigSnapshot(),
          "sessions.list": sessionsListResponse([]),
          "canopy.cards.list": cardsListResponse([reviewCard, doneCard]),
          "canopy.cards.move": { card: { ...reviewCard, status: "ready" } },
        },
      });
      await recorded.page.setViewportSize({ height: 760, width: 1200 });
      const response = await recorded.page.goto(`${suite.server.baseUrl}canopy`);
      expect(response?.status()).toBe(200);
      await recorded.page.locator(".canopy-column--review .canopy-card").waitFor();

      const reviewHeader = recorded.page.locator(
        ".canopy-column--review .canopy-column__header",
      );
      const collapseButton = reviewHeader.getByRole("button", { name: "Collapse Review column" });
      expect(await collapseButton.evaluate((button) => getComputedStyle(button).opacity)).toBe("0");
      await collapseButton.focus();
      await expect
        .poll(() => collapseButton.evaluate((button) => getComputedStyle(button).opacity))
        .toBe("1");
      await collapseButton.blur();
      await expect
        .poll(() => collapseButton.evaluate((button) => getComputedStyle(button).opacity))
        .toBe("0");
      await reviewHeader.hover();
      await expect
        .poll(() => collapseButton.evaluate((button) => getComputedStyle(button).opacity))
        .toBe("1");

      const collapsedColumns = recorded.page.locator(".canopy-column--collapsed");
      await expect.poll(() => collapsedColumns.count()).toBe(0);
      await openCanopyFilters(recorded.page);
      const emptyColumns = recorded.page.getByRole("group", { name: "Empty columns", exact: true });
      await emptyColumns.getByRole("button", { name: "Hide empty", exact: true }).click();
      await expect.poll(() => recorded.page.locator(".canopy-column").count()).toBe(2);
      await chooseCanopyDisplayOption(recorded.page, "Show all");
      await expect.poll(() => recorded.page.locator(".canopy-column").count()).toBe(9);
      await chooseCanopyDisplayOption(recorded.page, "Collapse empty");
      await expect.poll(() => collapsedColumns.count()).toBe(7);
      const collapsedWidth = await recorded.page
        .locator(".canopy-column--ready")
        .evaluate((column) => column.getBoundingClientRect().width);
      const reviewWidth = await recorded.page
        .locator(".canopy-column--review")
        .evaluate((column) => column.getBoundingClientRect().width);
      expect(collapsedWidth).toBeGreaterThanOrEqual(44);
      expect(collapsedWidth).toBeLessThanOrEqual(52);
      expect(reviewWidth).toBeGreaterThanOrEqual(262);

      const readyRail = recorded.page.locator(".canopy-column--ready .canopy-column__rail");
      const collapsedRailStyle = await readyRail.evaluate((rail) => ({
        boxShadow: getComputedStyle(rail).boxShadow,
      }));
      expect(collapsedRailStyle.boxShadow).toBe("none");

      await recorded.page.emulateMedia({ reducedMotion: "reduce" });
      const reducedMotionTransitions = await recorded.page.evaluate(() => ({
        collapse: getComputedStyle(
          document.querySelector(".canopy-column__collapse") as HTMLElement,
        ).transitionDuration,
        rail: getComputedStyle(
          document.querySelector(".canopy-column__rail-icon") as HTMLElement,
        ).transitionDuration,
      }));
      expect(reducedMotionTransitions).toEqual({ collapse: "0s", rail: "0s" });
      await recorded.page.emulateMedia({ reducedMotion: "no-preference" });

      await captureScreenshot(recorded.page, artifacts, "10-collapsed-columns-desktop");

      await recorded.page.getByRole("button", { name: "Expand Ready column" }).click();
      await expect
        .poll(() => recorded.page.locator(".canopy-column--ready").getAttribute("class"))
        .not.toContain("canopy-column--collapsed");
      const expandedWidth = await recorded.page
        .locator(".canopy-column--ready")
        .evaluate((column) => column.getBoundingClientRect().width);
      expect(expandedWidth).toBeGreaterThanOrEqual(262);
      await recorded.page.getByRole("button", { name: "Collapse Ready column" }).click();

      await closeCanopyFilters(recorded.page);
      await recorded.page
        .locator(".canopy-status-tabs")
        .getByRole("button", { name: "Review", exact: true })
        .click();
      const singleColumnBoard = recorded.page.locator(
        ".canopy-board--page.canopy-board--single-column",
      );
      const singleColumnGeometry = await singleColumnBoard.evaluate((board) => {
        const column = board.querySelector(".canopy-column") as HTMLElement;
        return {
          leftOffset: column.getBoundingClientRect().left - board.getBoundingClientRect().left,
          columnWidth: column.getBoundingClientRect().width,
        };
      });
      expect(singleColumnGeometry.columnWidth).toBeCloseTo(reviewWidth, 0);
      expect(singleColumnGeometry.leftOffset).toBeCloseTo(0, 0);
      await recorded.page
        .locator(".canopy-status-tabs")
        .getByRole("button", { name: "All", exact: true })
        .click();
      await closeCanopyFilters(recorded.page);

      const moveCount = (await gateway.getRequests("canopy.cards.move")).length;
      await recorded.page
        .locator(".canopy-column--review .canopy-card")
        .dragTo(recorded.page.locator(".canopy-column--ready .canopy-column__rail"));
      const moveRequest = await waitForNextRequest(gateway, "canopy.cards.move", moveCount);
      expect(requestParams(moveRequest)).toMatchObject({ id: reviewCard.id, status: "ready" });

      await recorded.page.setViewportSize({ height: 760, width: 700 });
      await openCanopyFilters(recorded.page);
      await expect.poll(() => emptyColumns.getByRole("button").count()).toBe(3);
      await closeCanopyFilters(recorded.page);
      const backlogColumn = recorded.page.locator(".canopy-column--backlog");
      const backlogRail = backlogColumn.getByRole("button", { name: "Expand Backlog column" });
      await backlogRail.scrollIntoViewIfNeeded();
      await backlogRail.focus();
      await recorded.page.keyboard.press("Enter");
      const collapseBacklog = backlogColumn.getByRole("button", {
        name: "Collapse Backlog column",
      });
      await expect.poll(() => collapseBacklog.isVisible()).toBe(true);
      await expect
        .poll(() =>
          backlogColumn.getByRole("button", { name: "New card in Backlog" }).last().isVisible(),
        )
        .toBe(true);
      await collapseBacklog.click();
      await expect.poll(() => backlogRail.isVisible()).toBe(true);
      await captureScreenshot(recorded.page, artifacts, "11-collapsed-columns-mobile");
    } finally {
      await closeRecordedPage(recorded, artifacts, "canopy-collapsed-columns");
    }
  });

  it("keeps touch collapse controls visible and at least 44px", async () => {
    await suite.withPage({ hasTouch: true }, async ({ page }) => {
      await installMockGateway(page, {
        ...canopyUi,
        methodResponses: {
          "config.get": canopyConfigSnapshot(),
          "sessions.list": sessionsListResponse([]),
          "canopy.cards.list": cardsListResponse([
            card({ id: "touch-review-card", status: "review", title: "Review on touch" }),
          ]),
        },
      });
      await page.setViewportSize({ height: 844, width: 390 });
      const response = await page.goto(`${suite.server.baseUrl}canopy`);
      expect(response?.status()).toBe(200);

      const collapseButton = page.getByRole("button", { name: "Collapse Review column" });
      await collapseButton.waitFor({ state: "visible" });
      await waitForControlUiProofSurface(collapseButton, []);
      const touchGeometry = await collapseButton.evaluate((button) => {
        const bounds = button.getBoundingClientRect();
        return {
          height: bounds.height,
          opacity: getComputedStyle(button).opacity,
          width: bounds.width,
        };
      });
      expect(touchGeometry.opacity).toBe("1");
      expect(touchGeometry.width).toBeGreaterThanOrEqual(44);
      expect(touchGeometry.height).toBeGreaterThanOrEqual(44);
    });
  });

  it("filters persisted boards and keeps the selection in the URL", async () => {
    const artifacts = createProofArtifacts("canopy-board-filter");
    const defaultCard = card({ id: "default-card", title: "Default board work" });
    const opsCard = card({
      id: "ops-card",
      title: "Operations board work",
      metadata: { automation: { boardId: "ops" } },
    });
    const boards: CanopyBoardSummary[] = [
      { id: "default", total: 1, active: 1, archived: 0, byStatus: { todo: 1 } },
      {
        id: "ops",
        name: "Operations",
        total: 1,
        active: 1,
        archived: 0,
        byStatus: { todo: 1 },
      },
      {
        id: "archive",
        name: "Old work",
        total: 0,
        active: 0,
        archived: 0,
        byStatus: {},
        archivedAt: baseTime,
      },
    ];
    const recorded = await newRecordedPage(artifacts, "canopy-board-filter");
    try {
      await installMockGateway(recorded.page, {
        ...canopyUi,
        methodResponses: {
          "config.get": canopyConfigSnapshot(),
          "sessions.list": sessionsListResponse([]),
          "canopy.boards.list": { boards },
          "canopy.cards.list": cardsListResponse([defaultCard, opsCard], boards),
        },
      });

      const response = await recorded.page.goto(
        `${suite.server.baseUrl}canopy?board=ops&agent=main`,
      );
      expect(response?.status()).toBe(200);
      await cardInColumn(recorded.page, "Todo", opsCard.title).waitFor({ state: "visible" });
      await expect.poll(() => new URL(recorded.page.url()).pathname).toBe("/canopy/ops");
      await expect.poll(() => recorded.page.getByText(defaultCard.title).count()).toBe(0);
      expect(new URL(recorded.page.url()).searchParams.has("board")).toBe(false);

      const historyBeforeFilter = await recorded.page.evaluate(() => history.length);
      await chooseCanopyBoard(recorded.page, "__all__");
      await cardInColumn(recorded.page, "Todo", defaultCard.title).waitFor({ state: "visible" });
      await expect.poll(() => new URL(recorded.page.url()).pathname).toBe("/canopy");
      expect(new URL(recorded.page.url()).searchParams.has("board")).toBe(false);
      expect(new URL(recorded.page.url()).search).toBe("?agent=main");

      await chooseCanopyBoard(recorded.page, "ops");
      await expect.poll(() => new URL(recorded.page.url()).pathname).toBe("/canopy/ops");
      expect(new URL(recorded.page.url()).search).toBe("?agent=main");
      expect(await recorded.page.evaluate(() => history.length)).toBe(historyBeforeFilter);
      expect(await recorded.page.getByText(defaultCard.title).count()).toBe(0);
      expect(
        await recorded.page.getByRole("option", { name: /Old work/u, includeHidden: true }).count(),
      ).toBeGreaterThan(0);
      await captureScreenshot(recorded.page, artifacts, "10-board-filter-ops");
    } finally {
      await closeRecordedPage(recorded, artifacts, "canopy-board-filter");
    }
  });
});
