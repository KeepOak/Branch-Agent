import "../../test/dom.setup.ts";
import { GatewayProtocolRequestError } from "@branch/gateway-client/browser";
import { expectDefined } from "@branch/normalization-core";
import { render as litRender, type LitElement } from "lit";
import type {
  ControlUiAgentPickerProps,
  ControlUiComponents,
} from "branch/plugin-sdk/control-ui";
import { createDeferred } from "branch/plugin-sdk/extension-shared";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { setCanopyCards } from "../../lib/canopy/card-state.ts";
import { getCanopyState, resetCanopyConnectionState } from "../../lib/canopy/index.ts";
import {
  createGatewaySession,
  createCanopyCard,
  createCanopyExecution,
  createCanopyTestClient,
} from "../../lib/canopy/test/index-helpers.ts";
import { canopyTestHost } from "../../test/host.setup.ts";
import { waitForFast } from "../../test/wait-for.ts";
import { renderCanopy } from "./view.ts";
const renderedRoots = new Set<ReturnType<typeof litRender>>();
function render(...args: Parameters<typeof litRender>) {
  const root = litRender(...args);
  renderedRoots.add(root);
  return root;
}
afterEach(() => {
  for (const root of renderedRoots) {
    root.setConnected(false);
  }
  renderedRoots.clear();
});
type ControlUiSelectPickerProps = Parameters<ControlUiComponents["mountSelectPicker"]>[1];
type SelectPicker = HTMLElement & ControlUiSelectPickerProps;
type AgentPicker = HTMLElement & ControlUiAgentPickerProps;

type CanopyRenderProps = Parameters<typeof renderCanopy>[0];
function createLoadedCanopyState() {
  const host = {};
  const state = getCanopyState(host);
  state.loaded = true;
  return { host, state };
}

function createCanopyRenderProps(
  host: CanopyRenderProps["host"],
  overrides: Partial<CanopyRenderProps> = {},
): CanopyRenderProps {
  return {
    host,
    client: null,
    connected: true,
    agentsList: null,
    sessions: [],
    onOpenSession: () => undefined,
    onRefresh: () => undefined,
    ...overrides,
  };
}

function renderInto(container: HTMLElement, props: CanopyRenderProps) {
  canopyTestHost().connection.connected = props.connected;
  if (!container.isConnected) {
    document.body.append(container);
  }
  render(renderCanopy(props), container);
}

function createCanopyView(
  overrides: Partial<CanopyRenderProps> = {},
  host: CanopyRenderProps["host"] = {},
) {
  const state = getCanopyState(host);
  state.loaded = true;
  const container = document.createElement("div");
  const props = createCanopyRenderProps(host, overrides);
  const renderView = (next: Partial<CanopyRenderProps> = {}) =>
    renderInto(container, { ...props, ...next });
  return { host, state, container, renderView };
}

function buttonByLabel(container: Element, label: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) =>
        button.getAttribute("aria-label") === label || button.textContent?.trim() === label,
    ) ?? null
  );
}

function buttonByText(container: Element, text: string): HTMLButtonElement | null {
  return (
    Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes(text),
    ) ?? null
  );
}

function requireButton(root: Element, label: string) {
  return expectDefined(buttonByLabel(root, label), label);
}

function textButton(root: Element, text: string) {
  return expectDefined(buttonByText(root, text), text);
}

async function inlineEditor(container: Element, field: "title" | "notes" | "labels") {
  const trigger = await waitForFast(() =>
    expectDefined(
      container.querySelector<HTMLButtonElement>(`.canopy-detail__text-trigger--${field}`),
      `.canopy-detail__text-trigger--${field}`,
    ),
  );
  const owner = expectDefined(
    trigger.closest<HTMLElement>("canopy-inline-text"),
    "inline editor",
  );
  const popover = owner.querySelector<HTMLElement>("[popover]");
  if (popover) {
    popover.showPopover = vi.fn();
  }
  return {
    trigger,
    owner,
    popover,
    open: async () => {
      trigger.click();
      return waitForFast(() =>
        expectDefined(
          owner.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea"),
          "input, textarea",
        ),
      );
    },
  };
}

function draftPicker(container: Element, label: string) {
  return expectDefined(
    [
      ...container.querySelectorAll<SelectPicker>(".canopy-draft [data-test-select-picker]"),
    ].find((picker) => picker.accessibleLabel === label),
    `card ${label} picker`,
  );
}

function sessionPicker(container: Element) {
  return draftPicker(container, "Session");
}

function filterPicker(container: Element, label: string) {
  return expectDefined(
    [
      ...container.querySelectorAll<SelectPicker>(
        label === "Agent"
          ? ".canopy-agent-filter [data-test-select-picker]"
          : ".canopy-filter-popover [data-test-select-picker]",
      ),
    ].find((picker) => picker.accessibleLabel === label),
    `filter picker ${label}`,
  );
}

function statusButton(container: Element, label: string) {
  return requireButton(
    expectDefined(
      container.querySelector<HTMLElement>(
        '.canopy-status-tabs[role="group"][aria-label="Status"]',
      ),
      '.canopy-status-tabs[role="group"][aria-label="Status"]',
    ),
    label,
  );
}

function toast(container: Element) {
  return expectDefined(
    container.querySelector<HTMLElement>("branch-canopy-toast:not([hidden])"),
    "branch-canopy-toast:not([hidden])",
  );
}

describe("renderCanopy", () => {
  it("retries only pending bulk edits after the second card fails", async () => {
    const first = createCanopyCard({ id: "first", agentId: "writer" });
    const second = createCanopyCard({ id: "second", agentId: "writer", position: 2000 });
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        card: { ...first, agentId: "main", updatedAt: first.updatedAt + 1 },
      })
      .mockRejectedValueOnce(new Error("Second card update rejected"))
      .mockResolvedValueOnce({
        card: { ...second, agentId: "main", updatedAt: second.updatedAt + 1 },
      });
    const { state, container, renderView } = createCanopyView({
      client: { request },
      connected: true,
      canWrite: true,
      agentsList: { defaultId: "main", agents: [{ id: "main" }, { id: "writer" }] },
    });
    state.cards = [first, second];
    state.selectedCardIds = new Set([first.id, second.id]);
    renderView();
    requireButton(container, "Edit properties").click();
    renderView();
    const picker = expectDefined(
      container.querySelector<SelectPicker>(".canopy-bulk-dialog [data-test-select-picker]"),
      ".canopy-bulk-dialog [data-test-select-picker]",
    );
    expect(picker.accessibleLabel).toBe("Agent");
    picker.onSelect("main");
    renderView();
    requireButton(container, "Apply changes").click();
    await vi.waitFor(() => expect(state.bulkSaving).toBe(false));
    expect(request).toHaveBeenCalledTimes(2);
    expect(state.cards.find((card) => card.id === first.id)?.agentId).toBe("main");
    expect(state.cards.find((card) => card.id === second.id)?.agentId).toBe("writer");
    expect(state.selectedCardIds).toEqual(new Set([second.id]));
    expect(state.bulkDialog?.cardIds).toEqual([second.id]);
    expect(state.bulkResult).toEqual({ completed: 1, total: 2 });
    renderView();
    await waitForFast(() => {
      const errorToast = container.querySelector("branch-canopy-toast:not([hidden])");
      expect(errorToast?.shadowRoot?.querySelector('[role="alert"]')?.textContent).toContain(
        "Applied to 1 of 2 cards. Second card update rejected",
      );
    });
    requireButton(container, "Apply changes").click();
    await vi.waitFor(() => expect(state.bulkSaving).toBe(false));
    expect(request.mock.calls).toEqual(
      [first, second, second].map((card) => [
        "canopy.cards.update",
        { id: card.id, expectedUpdatedAt: card.updatedAt, patch: { agentId: "main" } },
      ]),
    );
    expect(state.cards.every((card) => card.agentId === "main")).toBe(true);
    expect(state.selectedCardIds.size).toBe(0);
    expect(state.bulkDialog).toBeNull();
    expect(state.bulkResult).toEqual({ completed: 1, total: 1 });
    expect(state.error).toBeNull();
  });

  it.each(["write revocation", "disconnect", "activation disposal"] as const)(
    "stops a bulk assignment after live host %s while the first write is pending",
    async (change) => {
      const first = createCanopyCard({ id: "first", agentId: "writer" });
      const second = createCanopyCard({ id: "second", agentId: "writer", position: 2000 });
      const firstWrite = createDeferred<{
        card: typeof first;
      }>();
      const request = vi
        .fn()
        .mockImplementationOnce(() => firstWrite.promise)
        .mockResolvedValue({ card: { ...second, agentId: "main" } });
      const { state, container, renderView } = createCanopyView({
        client: { request },
        connected: true,
        canWrite: true,
        agentsList: { defaultId: "main", agents: [{ id: "main" }, { id: "writer" }] },
      });
      state.cards = [first, second];
      state.selectedCardIds = new Set([first.id, second.id]);
      renderView();
      const picker = expectDefined(
        [
          ...container.querySelectorAll<SelectPicker>(
            ".canopy-selection [data-test-select-picker]",
          ),
        ].find((item) => item.accessibleLabel === "Assign agent…"),
        "bulk assignment",
      );
      picker.onSelect("main");
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      expect(state.bulkSaving).toBe(true);
      const connection = canopyTestHost().connection;
      if (change === "disconnect") {
        connection.connected = false;
      } else if (change === "write revocation") {
        connection.canWrite = false;
      } else {
        canopyTestHost().dispose();
      }
      firstWrite.resolve({ card: { ...first, agentId: "main", updatedAt: first.updatedAt + 1 } });
      await vi.waitFor(() => expect(state.bulkSaving).toBe(false));
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith("canopy.cards.update", {
        id: first.id,
        expectedUpdatedAt: first.updatedAt,
        patch: { agentId: "main" },
      });
      expect(state.cards.find((card) => card.id === first.id)?.agentId).toBe("main");
      expect(state.cards.find((card) => card.id === second.id)?.agentId).toBe("writer");
      expect(state.selectedCardIds).toEqual(new Set([second.id]));
      expect(state.bulkResult).toEqual({ completed: 1, total: 2 });
      expect(state.error).toContain("Applied to 1 of 2 cards.");
    },
  );

  it("clears selection and stops pending work on board scope changes but retains query/status selection", async () => {
    const first = createCanopyCard({
      id: "first",
      metadata: { automation: { boardId: "one" } },
      agentId: "writer",
    });
    const second = createCanopyCard({
      id: "second",
      metadata: { automation: { boardId: "one" } },
      agentId: "writer",
    });
    const pending = createDeferred<{
      card: typeof first;
    }>();
    const request = vi.fn().mockImplementation(() => pending.promise);
    const { state, container, renderView } = createCanopyView({
      client: { request },
      canWrite: true,
      agentsList: { defaultId: "main", agents: [{ id: "main" }, { id: "writer" }] },
    });
    state.cards = [first, second];
    state.boardFilter = "one";
    state.selectedCardIds = new Set([first.id, second.id]);
    renderView();
    state.query = "unmatched";
    state.statusFilter = new Set(["done"]);
    renderView();
    expect(state.selectedCardIds).toEqual(new Set([first.id, second.id]));
    const assign = expectDefined(
      [
        ...container.querySelectorAll<SelectPicker>(
          ".canopy-selection [data-test-select-picker]",
        ),
      ].find((picker) => picker.accessibleLabel === "Assign agent…"),
      "assignment",
    );
    assign.onSelect("main");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    state.boardFilter = "two";
    renderView();
    expect(state.selectedCardIds.size).toBe(0);
    expect(state.bulkDialog).toBeNull();
    // Returning to the original scope cannot revive the pending batch.
    state.boardFilter = "one";
    renderView();
    pending.resolve({ card: { ...first, agentId: "main", updatedAt: first.updatedAt + 1 } });
    await vi.waitFor(() => expect(state.bulkSaving).toBe(false));
    expect(request).toHaveBeenCalledTimes(1);
    expect(state.cards.find((card) => card.id === second.id)?.agentId).toBe("writer");
    expect(state.selectedCardIds.size).toBe(0);
  });

  it("drops a live card outside the selected local agent scope before actions and during pending work", async () => {
    const first = createCanopyCard({
      id: "first",
      agentId: "writer",
      metadata: { automation: { boardId: "one" } },
    });
    const second = createCanopyCard({ ...first, id: "second", position: 2000 });
    const outside = { ...second, agentId: "main", updatedAt: second.updatedAt + 1 };
    const pending = createDeferred<{
      card: typeof first;
    }>();
    const request = vi.fn().mockImplementation(() => pending.promise);
    const { state, container, renderView } = createCanopyView({
      client: { request },
      canWrite: true,
      scopeAgentId: undefined,
      agentsList: { defaultId: "main", agents: [{ id: "main" }, { id: "writer" }] },
    });
    state.boardFilter = "one";
    state.agentFilter = "writer";
    state.cards = [first, second];
    state.selectedCardIds = new Set([first.id, second.id]);
    renderView();
    state.query = "unmatched";
    state.statusFilter = new Set(["done"]);
    setCanopyCards(state, [first, outside]);
    renderView();
    expect(state.selectedCardIds).toEqual(new Set([first.id]));
    // Keep a second eligible selection, then move it remotely while the first request is pending.
    setCanopyCards(state, [first, second]);
    state.selectedCardIds.add(second.id);
    renderView();
    requireButton(container, "Archive").click();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    setCanopyCards(state, [first, outside]);
    pending.resolve({
      card: { ...first, metadata: { ...first.metadata, archivedAt: first.updatedAt + 1 } },
    });
    await vi.waitFor(() => expect(state.bulkSaving).toBe(false));
    expect(request).toHaveBeenCalledTimes(1);
    expect(state.cards.find((card) => card.id === second.id)).toEqual(outside);
    expect(state.selectedCardIds.size).toBe(0);
  });

  it.each(["none", "before cleanup", "after cleanup"] as const)(
    "deletes linked selections without adopting unrelated edits: %s",
    async (concurrentEdit) => {
      const parent = createCanopyCard({ id: "parent" });
      const child = createCanopyCard({
        id: "child",
        position: 2000,
        metadata: {
          links: [{ id: "link", type: "parent", targetCardId: parent.id, createdAt: 1 }],
        },
      });
      const previousUpdatedAt = child.updatedAt + (concurrentEdit === "before cleanup" ? 1 : 0);
      const cleanupUpdatedAt = previousUpdatedAt + 1;
      const latest = {
        ...child,
        metadata: undefined,
        updatedAt: cleanupUpdatedAt + (concurrentEdit === "after cleanup" ? 1 : 0),
        title: concurrentEdit === "none" ? child.title : "Edited by another client",
      };
      const request = vi.fn().mockImplementation(async (_method, params) => {
        if (params.id === parent.id) {
          if (concurrentEdit !== "none") {
            setCanopyCards(state, [
              parent,
              {
                ...latest,
                updatedAt:
                  concurrentEdit === "before cleanup" ? previousUpdatedAt : latest.updatedAt,
              },
            ]);
          }
          return {
            deleted: true,
            referenceUpdates: [{ id: child.id, previousUpdatedAt, updatedAt: cleanupUpdatedAt }],
          };
        }
        if (params.expectedUpdatedAt !== latest.updatedAt) {
          throw new GatewayProtocolRequestError({
            code: "canopy_conflict",
            message: "Card changed. Review and retry.",
            details: { type: "canopy_card_conflict", card: latest },
          });
        }
        return { deleted: true };
      });
      const { state, container, renderView } = createCanopyView({
        client: { request },
        canWrite: true,
      });
      state.cards = [parent, child];
      state.selectedCardIds = new Set([parent.id, child.id]);
      renderView();
      expectDefined(
        container.querySelector<HTMLButtonElement>(".canopy-selection__delete"),
        ".canopy-selection__delete",
      ).click();
      renderView();
      expectDefined(
        container.querySelector<HTMLButtonElement>('.canopy-bulk-dialog button[type="submit"]'),
        '.canopy-bulk-dialog button[type="submit"]',
      ).click();
      await vi.waitFor(() => expect(state.bulkSaving).toBe(false));
      expect(request).toHaveBeenCalledTimes(2);
      expect(request).toHaveBeenNthCalledWith(2, "canopy.cards.delete", {
        id: child.id,
        expectedUpdatedAt: concurrentEdit === "before cleanup" ? child.updatedAt : cleanupUpdatedAt,
      });
      if (concurrentEdit === "none") {
        expect(state.cards).toEqual([]);
        expect(state.selectedCardIds.size).toBe(0);
        expect(state.error).toBeNull();
      } else {
        expect(state.cards).toEqual([latest]);
        expect(state.selectedCardIds).toEqual(new Set([child.id]));
        expect(state.error).toContain("Card changed. Review and retry.");
      }
    },
  );

  it.each(["move", "archive", "delete"] as const)(
    "stops bulk %s on a newer card revision and retains it for retry",
    async (action) => {
      const first = createCanopyCard({ id: "first" });
      const second = createCanopyCard({ id: "second", position: 2000 });
      const newer = { ...second, title: "Changed elsewhere", updatedAt: second.updatedAt + 10 };
      const pending = createDeferred<unknown>();
      const request = vi
        .fn()
        .mockImplementationOnce(() => pending.promise)
        .mockImplementation(async () => {
          throw new GatewayProtocolRequestError({
            code: "canopy_conflict",
            message: "Card changed. Review and retry.",
            details: { type: "canopy_card_conflict", card: newer },
          });
        });
      const { state, container, renderView } = createCanopyView({
        client: { request },
        canWrite: true,
      });
      state.cards = [first, second];
      state.selectedCardIds = new Set([first.id, second.id]);
      renderView();
      if (action === "move") {
        expectDefined(
          container.querySelector<SelectPicker>(".canopy-selection [data-test-select-picker]"),
          ".canopy-selection [data-test-select-picker]",
        ).onSelect("done");
      } else {
        requireButton(container, action === "archive" ? "Archive" : "Delete").click();
        if (action === "delete") {
          setCanopyCards(state, [first, newer]);
          renderView();
          expectDefined(
            container.querySelector<HTMLButtonElement>(
              '.canopy-bulk-dialog button[type="submit"]',
            ),
            '.canopy-bulk-dialog button[type="submit"]',
          ).click();
        }
      }
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      // Refresh while processing the first card must not replace the observed revision.
      setCanopyCards(state, [first, newer]);
      pending.resolve(
        action === "delete"
          ? { deleted: true }
          : {
              card: {
                ...first,
                status: action === "move" ? "done" : first.status,
                metadata:
                  action === "archive" ? { archivedAt: first.updatedAt + 1 } : first.metadata,
              },
            },
      );
      await vi.waitFor(() => expect(state.bulkSaving).toBe(false));
      expect(request).toHaveBeenCalledTimes(2);
      expect(request).toHaveBeenNthCalledWith(
        2,
        `canopy.cards.${action}`,
        expect.objectContaining({ id: second.id, expectedUpdatedAt: second.updatedAt }),
      );
      expect(state.cards.find((card) => card.id === second.id)).toEqual(newer);
      expect(state.selectedCardIds).toEqual(new Set([second.id]));
      expect(state.error).toContain("Card changed. Review and retry.");
    },
  );

  it("does not bulk-delete a card archived during the first delete", async () => {
    const first = createCanopyCard({ id: "first" });
    const second = createCanopyCard({ id: "second", position: 2000 });
    const archived = { ...second, metadata: { archivedAt: second.updatedAt + 1 } };
    const firstWrite = createDeferred<{
      deleted: boolean;
    }>();
    const request = vi
      .fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockResolvedValue({ deleted: true });
    const { state, container, renderView } = createCanopyView({
      client: { request },
      connected: true,
      canWrite: true,
    });
    state.cards = [first, second];
    state.selectedCardIds = new Set([first.id, second.id]);
    renderView();
    expectDefined(
      container.querySelector<HTMLButtonElement>(".canopy-selection__delete"),
      ".canopy-selection__delete",
    ).click();
    renderView();
    expect(state.bulkDialog?.cardIds).toEqual([first.id, second.id]);
    expectDefined(
      container.querySelector<HTMLButtonElement>('.canopy-bulk-dialog button[type="submit"]'),
      '.canopy-bulk-dialog button[type="submit"]',
    ).click();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    setCanopyCards(state, [first, archived]);
    firstWrite.resolve({ deleted: true });
    await vi.waitFor(() => expect(state.bulkSaving).toBe(false));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("canopy.cards.delete", {
      id: first.id,
      expectedUpdatedAt: first.updatedAt,
    });
    expect(state.cards).toEqual([archived]);
    expect(state.selectedCardIds.size).toBe(0);
    expect(state.bulkDialog).toBeNull();
  });

  it("disposes the agent:work:dashboard-panel-close session summary when card details close", () => {
    const { state, container, renderView } = createCanopyView();
    state.detailCardId = "card-1";
    state.detailTab = "session";
    state.cards = [
      createCanopyCard({
        sessionKey: "agent:work:dashboard-panel-close",
        agentId: "reassigned",
      }),
    ];
    const mount = vi.mocked(canopyTestHost().host.components.mountSessionSummary);
    renderView({
      sessions: [
        createGatewaySession({ key: "agent:work:dashboard-panel-close", agentId: "work" }),
      ],
    });
    expect(mount).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        session: { sessionKey: "agent:work:dashboard-panel-close", agentId: "work" },
      }),
    );
    const handle = mount.mock.results[0]!.value;
    state.detailCardId = null;
    renderView();
    expect(handle.dispose).toHaveBeenCalledOnce();
    expect(container.querySelector("[data-test-session-summary]")).toBeNull();
  });

  it.each([
    {
      name: "resolved",
      owners: ["main"],
      expected: "agent:main:subagent:canopy-default-card-1",
    },
    { name: "missing", owners: [], expected: undefined },
  ])(
    "uses only an identified execution for a $name provisional session",
    ({ owners, expected }) => {
      const onOpenSession = vi.fn();
      const { state, container, renderView } = createCanopyView({
        onOpenSession,
        sessions: owners.map((owner) =>
          createGatewaySession({ key: `agent:${owner}:subagent:canopy-default-card-1` }),
        ),
        sessionResolution: expected
          ? {
              key: "subagent:canopy-default-card-1",
              status: "resolved",
              session: createGatewaySession({ key: expected }),
            }
          : {
              key: "subagent:canopy-default-card-1",
              status: owners.length > 1 ? "ambiguous" : "unavailable",
            },
      });
      state.cards = [
        createCanopyCard({ agentId: "worker", sessionKey: "subagent:canopy-default-card-1" }),
      ];
      state.detailCardId = "card-1";
      state.detailTab = "session";
      const mount = vi.mocked(canopyTestHost().host.components.mountSessionSummary);
      renderView();
      const open = container.querySelector<HTMLButtonElement>(
        ".canopy-detail .canopy-detail__session-link",
      );
      if (expected) {
        expect(mount).toHaveBeenCalledWith(
          expect.any(HTMLElement),
          expect.objectContaining({ session: { sessionKey: expected } }),
        );
        expectDefined(open, "resolved session action").click();
        expect(onOpenSession).toHaveBeenCalledWith({ sessionKey: expected });
      } else {
        expect(mount).not.toHaveBeenCalled();
        expect(open).toBeNull();
      }
    },
  );

  it("preserves error visibility and dismissal through details dialogs", async () => {
    const { state, container, renderView } = createCanopyView();
    const card = createCanopyCard();
    state.cards = [card];
    state.detailCardId = card.id;
    const pageError = "Metadata unavailable. Linked session unavailable.";
    const expectError = async (message: string) => {
      await waitForFast(() => {
        const visible = container.querySelectorAll("branch-canopy-toast:not([hidden])");
        expect(visible).toHaveLength(1);
        expect(visible[0]?.shadowRoot?.querySelector('[role="alert"]')?.textContent).toBe(message);
      });
    };
    renderView({ pageError });
    await expectError(pageError);
    state.error = "Save denied";
    renderView({ pageError });
    await expectError("Save denied");
    state.error = null;
    renderView({ pageError });
    await expectError(pageError);
    const dialogToast = expectDefined(
      container.querySelector<HTMLElement>("branch-canopy-toast:not([hidden])"),
      "branch-canopy-toast:not([hidden])",
    );
    expectDefined(
      dialogToast.shadowRoot?.querySelector<HTMLButtonElement>('button[aria-label="Close"]'),
      'button[aria-label="Close"]',
    ).click();
    await waitForFast(() => {
      expect(dialogToast.shadowRoot?.querySelector('[role="alert"]')).toBeNull();
    });
    state.detailCardId = null;
    state.bulkDialog = null;
    state.draftOpen = false;
    state.draftDiscardOpen = false;
    renderView({ pageError });
    const active = expectDefined(
      container.querySelector<LitElement>("branch-canopy-toast:not([hidden])"),
      "branch-canopy-toast:not([hidden])",
    );
    await active.updateComplete;
    expect(active.shadowRoot?.querySelector('[role="alert"]')).toBeNull();
    // Recovery makes a subsequent identical failure a new visible outcome.
    renderView({ pageError: undefined });
    await active.updateComplete;
    expect(active.shadowRoot?.querySelector('[role="alert"]')).toBeNull();
    renderView({ pageError });
    await expectError(pageError);
  });

  it("keeps refresh context accessible while loading", async () => {
    const { state, container, renderView } = createCanopyView();
    state.loading = true;
    state.lastRefreshAt = new Date("2026-06-03T18:47:00Z").getTime();
    renderView();
    expect(buttonByLabel(container, "Compact")).not.toBeNull();
    expect(
      container.querySelector(".canopy-refresh")?.parentElement?.getAttribute("title"),
    ).toContain("Refreshing");
    expect(container.querySelector(".canopy-refresh")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".canopy-refresh")?.textContent).not.toContain("Refreshing");
    state.loading = false;
    state.lastRefreshError = "Card refresh unavailable";
    renderView();
    await waitForFast(() =>
      expect(
        toast(container).shadowRoot?.querySelector('[role="alert"]')?.textContent?.trim(),
      ).toBe("Card refresh unavailable"),
    );
    expect(buttonByLabel(container, "Refresh")?.disabled).toBe(false);
    state.lastRefreshError = null;
    renderView();
    await waitForFast(() =>
      expect(toast(container).shadowRoot?.querySelector('[role="alert"]')).toBeNull(),
    );
  });

  it("highlights only the current drag destination and clears it on exit", () => {
    const { state, container, renderView } = createCanopyView({ canWrite: true });
    state.cards = [createCanopyCard({ title: "Drag feedback" })];
    state.draggedCardId = "card-1";
    renderView();
    expect(container.querySelector(".canopy-card")?.classList).toContain(
      "canopy-card--dragging",
    );
    expect(container.querySelector(".canopy-column--drop-target")).toBeNull();
    const running = container.querySelector(".canopy-column--running")!;
    const todo = container.querySelector(".canopy-column--todo")!;
    running.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    renderView();
    expect(container.querySelectorAll(".canopy-column--drop-target")).toHaveLength(1);
    expect(running.classList).toContain("canopy-column--drop-target");
    todo.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    renderView();
    expect(container.querySelectorAll(".canopy-column--drop-target")).toHaveLength(1);
    expect(todo.classList).toContain("canopy-column--drop-target");
    todo.dispatchEvent(new MouseEvent("dragleave", { relatedTarget: todo.firstElementChild }));
    expect(state.dragOverStatus).toBe("todo");
    todo.dispatchEvent(new Event("dragleave"));
    renderView();
    expect(container.querySelector(".canopy-column--drop-target")).toBeNull();
    running.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
    container.querySelector(".canopy-card")!.dispatchEvent(new Event("dragend"));
    renderView();
    expect(state.draggedCardId).toBeNull();
    expect(state.dragOverStatus).toBeNull();
    expect(container.querySelector(".canopy-card--dragging")).toBeNull();
    expect(container.querySelector(".canopy-column--drop-target")).toBeNull();
  });

  it("moves the resolved active list card when a drop has no transfer payload", async () => {
    const card = createCanopyCard({ title: "Fallback drag move" });
    const moved = { ...card, status: "running" as const, position: 1000 };
    const request = vi.fn(async () => ({ card: moved }));
    const { state, container, renderView } = createCanopyView({
      client: { request } as unknown as GatewayBrowserClient,
    });
    state.viewMode = "list";
    state.cards = [card];
    state.draggedCardId = card.id;
    renderView();
    container
      .querySelector(".canopy-column--running")
      ?.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith("canopy.cards.move", {
      id: card.id,
      status: "running",
      position: 1000,
    });
    expect(state.cards).toContainEqual(moved);
  });

  it("hides cached card mutation controls until a lifecycle teardown reload succeeds", () => {
    const { host, state, container, renderView } = createCanopyView();
    state.cards = [createCanopyCard({ title: "Stale cached card" })];
    resetCanopyConnectionState(host);
    renderView();
    expect(buttonByLabel(container, "Edit card")).toBeNull();
    expect(buttonByLabel(container, "Archive card")).toBeNull();
    expect(buttonByText(container, "New card")).toBeNull();
    expect(container.querySelector(".canopy-card")?.getAttribute("draggable")).toBe("false");
    state.mutationReadiness = "ready";
    renderView();
    expect(buttonByLabel(container, "Edit card")).not.toBeNull();
    expect(buttonByText(container, "New card")).not.toBeNull();
  });

  it("keeps a stale edit draft disabled until it is cancelled", async () => {
    const { host, state, container, renderView } = createCanopyView();
    state.cards = [createCanopyCard({ title: "Canonical title" })];
    state.draftOpen = true;
    state.editingCardId = "card-1";
    state.draftTitle = "Unsaved edit";
    resetCanopyConnectionState(host);
    renderView();
    state.mutationReadiness = "stale_edit_draft";
    renderView();
    expect(
      container.querySelector<HTMLButtonElement>(".canopy-modal__actions .primary")?.disabled,
    ).toBe(true);
    expect(container.querySelector<HTMLInputElement>(".canopy-draft__title")?.value).toBe(
      "Unsaved edit",
    );
    const cancelButton = container.querySelector<HTMLButtonElement>('button[aria-label="Cancel"]');
    expect(cancelButton?.disabled).toBe(false);
    cancelButton?.click();
    expect(state.draftOpen).toBe(false);
  });

  it.each([
    { label: "id", failedId: "a", completedId: "z", failedSequence: 1, completedSequence: 1 },
    {
      label: "legacy entry",
      failedId: "z",
      completedId: "a",
      failedSequence: 1,
      completedSequence: undefined,
    },
  ])(
    "does not show an obsolete same-time failure after completion ordered by $label",
    ({ failedId, completedId, completedSequence }) => {
      const { state, container, renderView } = createCanopyView();
      state.cards = [
        createCanopyCard({
          status: "blocked",
          runId: "current-run",
          metadata: {
            notifications: [
              {
                id: failedId,
                kind: "failed",
                createdAt: 2,
                sequence: 1,
                runId: "current-run",
                message: "Obsolete run failure.",
              },
              {
                id: completedId,
                kind: "completed",
                createdAt: 2,
                sequence: completedSequence,
                runId: "current-run",
                message: "Run completed.",
              },
            ],
          },
        }),
      ];
      renderView();
      expect(container.querySelector(".canopy-card__alert")).toBeNull();
      expect(container.textContent).not.toContain("Obsolete run failure.");
    },
  );

  it("preserves full diagnostic text in the list card's accessible description", () => {
    const sentinel = "SYNTHETIC_PRIVATE_OUTPUT";
    vi.mocked(canopyTestHost().host.redact).mockImplementation((text) =>
      text.replaceAll(sentinel, "[redacted]"),
    );
    const { state, container, renderView } = createCanopyView();
    state.viewMode = "list";
    state.cards = [
      createCanopyCard({
        id: "card-boundary",
        title: "Boundary badge",
        metadata: {
          diagnostics: [
            {
              kind: "orphaned_session",
              severity: "error",
              title: `${"x".repeat(158)}🚀tail ${sentinel}`,
              detail: `Boundary detail. ${sentinel}`,
              firstSeenAt: 1,
              lastSeenAt: 1,
              count: 1,
              actions: [],
            },
            {
              kind: "missing_proof",
              severity: "warning",
              title: "Release verification",
              detail: "The supporting evidence is still missing.",
              firstSeenAt: 1,
              lastSeenAt: 1,
              count: 1,
              actions: [],
            },
          ],
        },
      }),
    ];
    renderView();
    expect(container.querySelector(".canopy-card__alert--error")?.textContent?.trim()).toBe(
      `${"x".repeat(158)}🚀tail [redacted]`,
    );
    expect(container.querySelector(".canopy-card__alert")?.getAttribute("title")).toContain(
      `${"x".repeat(158)}🚀tail`,
    );
    const card = expectDefined(
      container.querySelector<HTMLElement>(".canopy-card"),
      ".canopy-card",
    );
    const descriptionId = expectDefined(
      card.getAttribute("aria-describedby"),
      "alert description ID",
    );
    const description = expectDefined(document.getElementById(descriptionId), "alert description");
    expect(description.textContent).toContain(`${"x".repeat(158)}🚀tail`);
    expect(description.textContent).toContain("Boundary detail.");
    expect(description.textContent).toContain("Release verification");
    expect(description.textContent).toContain("The supporting evidence is still missing.");
    expect(description.textContent).toContain("Boundary detail. [redacted]");
    expect(description.textContent).not.toContain(sentinel);
    expect(container.querySelector(".canopy-card__alert")?.getAttribute("title")).not.toContain(
      sentinel,
    );
  });

  it("filters cards by multiple selected statuses from menu", () => {
    const { state, container, renderView } = createCanopyView();
    state.cards = [
      createCanopyCard({ id: "ready", title: "Ready card", status: "ready" }),
      createCanopyCard({ id: "blocked", title: "Blocked card", status: "blocked" }),
      createCanopyCard({ id: "done", title: "Done card", status: "done" }),
    ];
    renderView();
    const selectStatus = (label: string) =>
      textButton(
        expectDefined(
          container.querySelector<HTMLElement>('[role="dialog"][aria-label="Status"]'),
          '[role="dialog"][aria-label="Status"]',
        ),
        label === "All" ? "All work" : label,
      );
    selectStatus("Ready").click();
    renderView();
    expect(container.querySelector(".canopy-board")?.textContent).toContain("Ready card");
    expect(container.querySelector(".canopy-board")?.textContent).not.toContain("Blocked card");
    selectStatus("Blocked").click();
    renderView();
    expect(state.statusFilter).toEqual(new Set(["ready", "blocked"]));
    expect(selectStatus("Ready").getAttribute("aria-pressed")).toBe("true");
    expect(selectStatus("Blocked").getAttribute("aria-pressed")).toBe("true");
    expect(selectStatus("All").getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector(".canopy-board")?.textContent).toContain("Blocked card");
    expect(container.querySelector(".canopy-board")?.textContent).not.toContain("Done card");
    selectStatus("All").click();
    renderView();
    expect(selectStatus("All").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".canopy-board")?.textContent).toContain("Done card");
  });

  it("keeps zero-result status filters selectable and clearable", () => {
    const { state, container, renderView } = createCanopyView();
    state.cards = [createCanopyCard({ id: "ready", title: "Ready card", status: "ready" })];
    renderView();
    const running = statusButton(container, "Running");
    expect(running.disabled).toBe(false);
    running.click();
    renderView();
    expect(container.querySelector(".canopy-empty-state")?.textContent).toContain(
      "No cards match this view",
    );
    textButton(container.querySelector(".canopy-empty-state")!, "Clear filters").click();
    renderView();
    expect(state.statusFilter.size).toBe(0);
    expect(container.querySelector(".canopy-board")?.textContent).toContain("Ready card");
  });

  it("keeps keyboard focus usable when search updates chips and chips are removed", async () => {
    const { state, container, renderView } = createCanopyView();
    state.statusFilter = new Set(["ready", "blocked"]);
    state.priorityFilter = new Set(["high"]);
    state.searchOpen = true;
    renderView();
    const search = expectDefined(
      container.querySelector<HTMLInputElement>("#canopy-search-input"),
      "#canopy-search-input",
    );
    search.focus();
    search.value = "release";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    renderView();
    expect(document.activeElement).toBe(search);
    const removeSearch = requireButton(container, "Remove filter: Search: “release”");
    const visibleRect = new DOMRect(0, 0, 120, 32);
    const visibleRects = Object.assign([visibleRect], {
      item: (index: number) => (index === 0 ? visibleRect : null),
    });
    // This DOM harness has no layout; model the chips visible in the desktop toolbar.
    for (const chip of container.querySelectorAll<HTMLButtonElement>(
      ".canopy-filter-chip__remove",
    )) {
      vi.spyOn(chip, "getClientRects").mockReturnValue(visibleRects);
    }
    removeSearch.focus();
    removeSearch.click();
    renderView();
    await Promise.resolve();
    expect(state.query).toBe("");
    const removePriority = requireButton(container, "Remove filter: Priority: High");
    expect(document.activeElement).toBe(removePriority);
    expect(state.statusFilter).toEqual(new Set(["ready", "blocked"]));
    removePriority.click();
    renderView();
    await Promise.resolve();
    expect(document.activeElement).toBe(buttonByLabel(container, "Filters"));
    expect(container.querySelectorAll(".canopy-filter-chip")).toHaveLength(0);
  });

  it("clears the mobile agent chip through global scope without clearing other filters", () => {
    const onClearAgentScope = vi.fn();
    const { state, container, renderView } = createCanopyView({
      scopeAgentId: "writer",
      agentsList: { defaultId: "main", agents: [{ id: "main" }, { id: "writer" }] },
      onClearAgentScope,
    });
    state.priorityFilter = new Set(["high"]);
    state.statusFilter = new Set(["ready"]);
    state.cards = [
      createCanopyCard({
        id: "writer-card",
        title: "Writer card",
        agentId: "writer",
        status: "ready",
        priority: "high",
      }),
      createCanopyCard({
        id: "main-card",
        title: "Main card",
        agentId: "main",
        status: "ready",
        priority: "high",
      }),
      createCanopyCard({
        id: "low-card",
        title: "Low priority",
        agentId: "main",
        status: "ready",
        priority: "low",
      }),
    ];
    renderView();
    expect(container.querySelector(".canopy-board")?.textContent).not.toContain("Main card");
    requireButton(container, "Remove filter: Agent: writer").click();
    expect(onClearAgentScope).toHaveBeenCalledOnce();
    renderView({ scopeAgentId: null });
    expect(buttonByLabel(container, "Remove filter: Agent: writer")).toBeNull();
    expect(container.querySelector(".canopy-board")?.textContent).toContain("Main card");
    expect(container.querySelector(".canopy-board")?.textContent).toContain("Writer card");
    expect(container.querySelector(".canopy-board")?.textContent).not.toContain("Low priority");
    expect(state.priorityFilter).toEqual(new Set(["high"]));
    expect(state.statusFilter).toEqual(new Set(["ready"]));
  });

  it("keeps list group actions independent of its disclosure while collapsed", () => {
    const { state, container, renderView } = createCanopyView({ canWrite: true });
    state.viewMode = "list";
    state.cards = [createCanopyCard({ id: "todo-card", title: "Review notes", status: "todo" })];
    state.collapsedStatuses.add("todo");
    renderView();
    const group = expectDefined(
      container.querySelector<HTMLElement>('section[aria-label="Todo, 1"]'),
      'section[aria-label="Todo, 1"]',
    );
    const actions = expectDefined(
      group.querySelector<HTMLButtonElement>("button[popovertarget]"),
      "button[popovertarget]",
    );
    actions.click();
    expect(group.querySelector("h2 button")?.getAttribute("aria-expanded")).toBe("false");
    textButton(group, "Select all").click();
    renderView();
    expect(state.selectedCardIds).toEqual(new Set(["todo-card"]));
    expect(group.querySelector('[role="listitem"]')).toBeNull();
    requireButton(group, "New card in Todo").click();
    renderView();
    expect(state.draftOpen).toBe(true);
    expect(state.draftStatus).toBe("todo");
    expect(state.collapsedStatuses).toContain("todo");
  });

  it("supports showing, collapsing, and hiding empty columns", () => {
    const { state, container, renderView } = createCanopyView({
      onRequestUpdate: () => undefined,
    });
    state.cards = [createCanopyCard({ title: "Keep visible" })];
    renderView();
    expect(container.querySelectorAll(".canopy-column")).toHaveLength(9);
    expect(container.querySelector(".canopy-column--collapsed")).toBeNull();
    buttonByLabel(container, "Collapse empty")?.click();
    renderView();
    expect(state.emptyColumnMode).toBe("collapse");
    expect(container.querySelectorAll(".canopy-column")).toHaveLength(9);
    expect(container.querySelectorAll(".canopy-column--collapsed")).toHaveLength(8);
    expect(container.querySelector(".canopy-column--todo")?.classList).not.toContain(
      "canopy-column--collapsed",
    );
    buttonByLabel(container, "Collapse Todo column")?.click();
    renderView();
    expect(state.collapsedStatuses).toContain("todo");
    expect(container.querySelector(".canopy-column--todo")?.classList).toContain(
      "canopy-column--collapsed",
    );
    buttonByLabel(container, "Expand Todo column")?.click();
    renderView();
    expect(state.collapsedStatuses).not.toContain("todo");
    buttonByLabel(container, "Hide empty")?.click();
    renderView();
    expect(state.emptyColumnMode).toBe("hide");
    expect(container.querySelectorAll(".canopy-column")).toHaveLength(1);
    expect(container.querySelector(".canopy-column--todo")).not.toBeNull();
  });

  it("does not render Invalid Date for Date-invalid card timestamps", () => {
    const { state, container, renderView } = createCanopyView();
    state.cards = [
      createCanopyCard({
        title: "Bad timestamp card",
        updatedAt: 8_640_000_000_000_001,
        events: [{ id: "event-1", kind: "edited", at: 8_640_000_000_000_001 }],
        metadata: {
          attempts: [
            {
              id: "attempt-1",
              status: "failed",
              startedAt: 8_640_000_000_000_001,
              endedAt: 8_640_000_000_000_001,
              error: "Attempt evidence survives invalid dates",
            },
          ],
          proof: [
            {
              id: "proof-1",
              status: "passed",
              createdAt: 8_640_000_000_000_001,
              label: "Proof evidence survives invalid dates",
            },
          ],
        },
      }),
    ];
    renderView();
    expect(container.textContent).toContain("Bad timestamp card");
    expect(container.querySelector(".canopy-card__updated")).toBeNull();
    expect(container.textContent).not.toContain("Invalid Date");
    buttonByLabel(container, "View details")!.click();
    renderView();
    buttonByText(container.querySelector('[role="tablist"]')!, "Details")!.click();
    renderView();
    const details = expectDefined(
      container.querySelector<HTMLElement>("#canopy-detail-panel-details"),
      "#canopy-detail-panel-details",
    );
    expect(details.textContent).toContain("Attempt evidence survives invalid dates");
    expect(details.textContent).toContain("Proof evidence survives invalid dates");
    expect(details.textContent).not.toContain("Invalid Date");
  });

  it("opens board card details without hijacking action buttons", async () => {
    const onOpenSession = vi.fn();
    const { state, container, renderView } = createCanopyView({
      sessions: [
        {
          key: "agent:main:dashboard:1",
          kind: "direct",
          displayName: "Dashboard session",
          updatedAt: 2,
          hasActiveRun: true,
          status: "running",
        },
      ],
      onOpenSession,
    });
    state.viewMode = "board";
    state.cards = [
      createCanopyCard({
        title: "Inspect a running task",
        status: "running",
        sessionKey: "agent:main:dashboard:1",
      }),
    ];
    renderView();
    const card = expectDefined(
      container.querySelector<HTMLElement>(".canopy-card"),
      ".canopy-card",
    );
    expect(card.getAttribute("aria-pressed")).toBeNull();
    expect(card.getAttribute("aria-haspopup")).toBe("dialog");
    requireButton(card, "Open session").click();
    expect(onOpenSession).toHaveBeenCalledWith({ sessionKey: "agent:main:dashboard:1" });
    expect(state.detailCardId).toBeNull();
    expect(container.querySelector(".canopy-detail")).toBeNull();
    onOpenSession.mockClear();
    card.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    renderView();
    await waitForFast(() =>
      expect(container.querySelector(".canopy-detail")?.textContent).toContain(
        "Inspect a running task",
      ),
    );
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  it("keeps board keyboard selection intact when opening an action from the card menu", () => {
    const { state, container, renderView } = createCanopyView({ canWrite: true });
    state.viewMode = "board";
    state.cards = [
      createCanopyCard({ id: "first", title: "First row" }),
      createCanopyCard({ id: "second", title: "Second row" }),
    ];
    renderView();
    const rows = container.querySelectorAll<HTMLElement>(".canopy-card");
    const first = expectDefined(rows[0], "first list row");
    const second = expectDefined(rows[1], "second list row");
    expect(first.getAttribute("aria-pressed")).toBeNull();
    expect(second.getAttribute("aria-pressed")).toBeNull();
    first.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    renderView();
    expect(first.getAttribute("aria-pressed")).toBe("true");
    expect(second.getAttribute("aria-pressed")).toBe("false");
    expect(first.getAttribute("aria-haspopup")).toBeNull();
    expect(state.detailCardId).toBeNull();
    second.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }),
    );
    renderView();
    expect(state.selectedCardIds).toEqual(new Set(["first", "second"]));
    expect(second.getAttribute("aria-pressed")).toBe("true");
    expectDefined(
      second.querySelector<HTMLButtonElement>(".canopy-card__menu-trigger"),
      ".canopy-card__menu-trigger",
    ).click();
    expect(state.selectedCardIds).toEqual(new Set(["first", "second"]));
    expect(state.detailCardId).toBeNull();
    requireButton(second, "Edit card").click();
    renderView();
    expect(state.draftOpen).toBe(true);
    expect(state.editingCardId).toBe("second");
    expect(state.detailCardId).toBeNull();
    expect(state.selectedCardIds).toEqual(new Set(["first", "second"]));
  });

  it("passes dialog labels and cancellation back to the plugin draft owner", async () => {
    const { host, state } = createLoadedCanopyState();
    state.lastDispatchSummary = {
      started: 0,
      failures: 0,
      promoted: 0,
      blocked: 0,
      reclaimed: 0,
      orchestrated: 0,
    };
    state.draftOpen = true;
    state.draftTitle = "Unsaved task";
    const container = document.createElement("div");
    const props = createCanopyRenderProps(host, {
      onRequestUpdate: () => renderInto(container, props),
    });
    renderInto(container, props);
    expect(
      expectDefined(
        container.querySelector<HTMLElement>(".canopy > branch-canopy-toast"),
        ".canopy > branch-canopy-toast",
      ).hidden,
    ).toBe(true);
    const dialog = container.querySelector("[data-test-dialog]")!;
    expect(dialog.getAttribute("aria-label")).toBe("New card");
    expect(dialog.getAttribute("aria-description")).toContain("Queue work");
    state.draftSaving = true;
    renderInto(container, props);
    const blocked = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).toBe(true);
    expect(state.draftOpen).toBe(true);
    state.draftSaving = false;
    renderInto(container, props);
    dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(state.draftDiscardOpen).toBe(true);
    expect(state.draftOpen).toBe(true);
    textButton(container.querySelector(".canopy-discard")!, "Discard").click();
    expect(state.draftOpen).toBe(false);
    expect(container.querySelector(".canopy-draft")).toBeNull();
    await waitForFast(() =>
      expect(toast(container).shadowRoot?.querySelector("[role=status]")?.textContent?.trim()).toBe(
        "No cards were started.",
      ),
    );
  });

  it("shows unfinished parent dependencies without blocking stale local starts", () => {
    const { state, container, renderView } = createCanopyView({
      onRequestUpdate: () => undefined,
    });
    state.cards = [
      createCanopyCard({ id: "parent-1", title: "Finish art pass" }),
      createCanopyCard({
        id: "child-1",
        title: "Ship game shell",
        position: 2000,
        metadata: {
          links: [{ id: "link-1", type: "parent", targetCardId: "parent-1", createdAt: 1 }],
        },
      }),
    ];
    renderView();
    const childCard = [...container.querySelectorAll<HTMLElement>(".canopy-card")].find((card) =>
      card.textContent?.includes("Ship game shell"),
    );
    const start = childCard?.querySelector<HTMLButtonElement>(".canopy-card__start");
    expect(childCard?.textContent).toContain("1 blocked");
    expect(start?.disabled).toBe(false);
    expect(start?.getAttribute("aria-label")).toBe("Run default agent");
    childCard
      ?.querySelector<HTMLButtonElement>('button[aria-label="View details"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    renderView();
    const detail = container.querySelector(".canopy-detail");
    expect(detail?.textContent).toContain("Dependencies");
    expect(detail?.textContent).toContain("Finish art pass");
    expect(detail?.textContent).toContain("Todo");
    const detailRunButtons = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".canopy-detail .canopy-card__start--autonomous",
      ),
    ];
    const detailOpenButtons = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".canopy-detail .canopy-card__start--manual",
      ),
    ];
    expect(detailRunButtons.length).toBeGreaterThan(0);
    expect(detailRunButtons.every((button) => button.disabled)).toBe(false);
    expect(detailOpenButtons.length).toBeGreaterThan(0);
    expect(detailOpenButtons.every((button) => button.disabled)).toBe(false);
  });

  it("hides autonomous model override actions for non-admin operators", () => {
    const { state, container, renderView } = createCanopyView({ canModelOverride: false });
    state.cards = [createCanopyCard({ title: "Start with default model" })];
    renderView();
    const startButtons = [
      ...container.querySelectorAll<HTMLButtonElement>(".canopy-card__start"),
    ];
    expect(startButtons.map((button) => button.textContent?.trim())).toEqual(["Start"]);
    expect(startButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Run default agent",
    ]);
    container
      .querySelector<HTMLButtonElement>('button[aria-label="View details"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    renderView();
    const detailStartButtons = [
      ...container.querySelectorAll<HTMLButtonElement>(".canopy-detail .canopy-card__start"),
    ];
    expect(detailStartButtons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Run default agent",
      "Open OpenAI",
      "Open Claude",
    ]);
  });

  it("shows completed session identity without repeating a synthetic completion summary", () => {
    const onOpenSession = vi.fn();
    const sessionKey = "agent:main:completed-review";
    const { state, container, renderView } = createCanopyView({
      sessions: [
        {
          key: sessionKey,
          kind: "direct",
          displayName: "Release review",
          updatedAt: 2,
          status: "done",
          hasActiveRun: false,
        },
      ],
      onOpenSession,
    });
    state.cards = [createCanopyCard({ status: "done", sessionKey })];
    state.detailCardId = "card-1";
    renderView();
    for (const tab of ["Overview", "Session"]) {
      textButton(container.querySelector('[role="tablist"]')!, tab).click();
      renderView();
      const panel = expectDefined(
        container.querySelector<HTMLElement>(".canopy-detail__tabpanel:not([hidden])"),
        ".canopy-detail__tabpanel:not([hidden])",
      );
      expect(panel.querySelector(".canopy-detail__session-name")?.textContent).toContain(
        "Release review",
      );
      expect(panel.querySelector(".canopy-session-badge")?.textContent).toBe("Done");
      expect(panel.textContent).not.toContain("Run completed");
      requireButton(panel, "Open session").click();
      expect(onOpenSession).toHaveBeenLastCalledWith({ sessionKey });
    }
  });

  it("keeps queued session context readable until an outside pointer dismisses it", async () => {
    const { state, container, renderView } = createCanopyView({
      sessions: [
        {
          key: "agent:main:queued",
          kind: "direct",
          updatedAt: 2,
          hasActiveRun: true,
          status: "queued",
        },
      ],
    });
    state.cards = [createCanopyCard({ status: "todo", sessionKey: "agent:main:queued" })];
    renderView();
    const status = expectDefined(
      container.querySelector<
        LitElement & {
          presentation: {
            label: string;
          };
        }
      >("branch-canopy-session-status"),
      "branch-canopy-session-status",
    );
    expect(status.presentation.label).toBe("Queued");
    expect(container.querySelector(".canopy-card__session-marker")).toBeNull();
    expect(
      container.querySelector(".canopy-card__session-marker .session-run-spinner"),
    ).toBeNull();
    expect(container.querySelector(".canopy-card__session-name")?.textContent?.trim()).toBe(
      "Session",
    );
    await status.updateComplete;
    const trigger = expectDefined(
      status.querySelector<HTMLButtonElement>(".canopy-session-status__trigger"),
      ".canopy-session-status__trigger",
    );
    const panel = expectDefined(
      status.querySelector<HTMLElement>(".canopy-session-status__popover"),
      ".canopy-session-status__popover",
    );
    if (typeof panel.showPopover !== "function") {
      Object.defineProperty(panel, "showPopover", { configurable: true, value: vi.fn() });
    }
    const removeListener = vi.spyOn(document, "removeEventListener");
    try {
      // Pointer activation focuses the button before its click opens the explanation.
      trigger.focus();
      trigger.click();
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      expect(state.detailCardId).toBeNull();
      panel.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
      expect(trigger.getAttribute("aria-expanded")).toBe("true");

      // A nonfocusable outside target must dismiss even if the trigger retains focus.
      container.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
      expect(document.activeElement).toBe(trigger);
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      trigger.click();
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
      status.remove();
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(removeListener).toHaveBeenCalledWith("pointerdown", expect.any(Function), true);
    } finally {
      removeListener.mockRestore();
    }
  });

  it("hides write controls for read-only operators", () => {
    const { state, container, renderView } = createCanopyView({ canWrite: false });
    state.cards = [createCanopyCard({ title: "Inspect only" })];
    renderView();
    expect(buttonByLabel(container, "Edit card")).toBeNull();
    expect(buttonByLabel(container, "Delete card")).toBeNull();
    expect(container.querySelectorAll<HTMLButtonElement>(".canopy-card__start")).toHaveLength(0);
    expect(
      container.querySelector<HTMLButtonElement>(".canopy-heading__actions .btn.primary"),
    ).toBeNull();
    expect(container.querySelector<HTMLSelectElement>(".canopy-card__move-select")).toBeNull();
    expect(container.querySelector(".canopy-card")?.getAttribute("draggable")).toBe("false");
    expect(container.querySelector(".canopy-card")?.getAttribute("role")).toBe("button");
  });

  it("appends a status move after archived cards on its own board only", async () => {
    const { state, container, renderView } = createCanopyView();
    const movingCard = createCanopyCard({
      title: "Move within Operations",
      metadata: { automation: { boardId: "ops" } },
    });
    state.boardFilter = "ops";
    state.cards = [
      movingCard,
      createCanopyCard({
        id: "archived-ops-running",
        title: "Archived Operations run",
        status: "running",
        position: 3000,
        metadata: { archivedAt: 10, automation: { boardId: "ops" } },
      }),
      createCanopyCard({
        id: "product-running",
        title: "Unrelated Product run",
        status: "running",
        position: 9000,
        metadata: { automation: { boardId: "product" } },
      }),
    ];
    const moved = { ...movingCard, status: "running" as const, position: 4000 };
    const request = vi.fn(async () => ({ card: moved }));
    renderView({ client: { request } as unknown as GatewayBrowserClient });
    const moveSelect = container.querySelector<HTMLSelectElement>(".canopy-card__move-select");
    expect(moveSelect).not.toBeNull();
    moveSelect!.value = "running";
    moveSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith("canopy.cards.move", {
      id: movingCard.id,
      status: "running",
      position: 4000,
    });
    expect(state.cards).toContainEqual(moved);
  });

  it("moves a focused status control with keyboard arrows", async () => {
    const { state, container, renderView } = createCanopyView();
    state.cards = [createCanopyCard({ title: "Keyboard arrow move" })];
    const request = vi.fn(async () => ({
      card: { ...state.cards[0], status: "scheduled", position: 1000, updatedAt: 2 },
    }));
    renderView({ client: { request } as unknown as GatewayBrowserClient });
    const moveSelect = container.querySelector<HTMLSelectElement>(".canopy-card__move-select");
    const dispatched = moveSelect!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatched).toBe(false);
    expect(request).toHaveBeenCalledWith("canopy.cards.move", {
      id: "card-1",
      status: "scheduled",
      position: 1000,
    });
    expect(state.cards[0]).toMatchObject({ status: "scheduled", updatedAt: 2 });
  });

  it("does not queue status-control moves while a card is busy", async () => {
    const { state, container, renderView } = createCanopyView();
    state.busyCardIds.add("card-1");
    state.cards = [createCanopyCard({ title: "Busy move" })];
    const request = vi.fn();
    renderView({ client: { request } as unknown as GatewayBrowserClient });
    const moveSelect = container.querySelector<HTMLSelectElement>(".canopy-card__move-select");
    expect(moveSelect?.disabled).toBe(true);
    moveSelect!.value = "blocked";
    moveSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    const dispatched = moveSelect!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
    expect(dispatched).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(state.cards[0]).toMatchObject({ status: "todo", updatedAt: 1 });
  });

  it.each([
    {
      name: "the selected named agent filter",
      scopeAgentId: null,
      agentFilter: "ops",
      expectedAgentId: "ops",
    },
    {
      name: "the unassigned default-agent filter",
      scopeAgentId: null,
      agentFilter: "default",
      expectedAgentId: "",
    },
  ])("initializes new cards from $name", ({ agentFilter, expectedAgentId }) => {
    const { state, container, renderView } = createCanopyView({
      agentsList: {
        defaultId: "main",
        agents: [
          { id: "main", name: "Main" },
          { id: "writer", name: "Writer" },
          { id: "ops", name: "Ops" },
          { id: "canopy-dispatcher", kind: "system", name: "Dispatcher" },
        ],
      },
      scopeAgentId: null,
    });
    state.agentFilter = agentFilter;
    renderView();
    container
      .querySelector<HTMLButtonElement>(".canopy-heading__actions .canopy-create")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    renderView();
    expect(state.draftOpen).toBe(true);
    expect(state.draftAgentId).toBe(expectedAgentId);
    expect(
      container.querySelector<
        HTMLElement & {
          value: string;
        }
      >(".canopy-draft .canopy-agent-select [data-test-agent-picker]")?.value,
    ).toBe(expectedAgentId);
  });

  it("keeps a selected named agent while its roster has not loaded", () => {
    const { state, container, renderView } = createCanopyView({
      agentsList: null,
      defaultAgentId: "main",
      scopeAgentId: "writer",
    });
    state.agentFilter = "all";
    renderView();
    container
      .querySelector<HTMLButtonElement>(".canopy-heading__actions .canopy-create")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    renderView();
    expect(state.draftOpen).toBe(true);
    expect(state.draftAgentId).toBe("writer");
    expect(
      container.querySelector<
        HTMLElement & {
          value: string;
        }
      >(".canopy-draft .canopy-agent-select [data-test-agent-picker]")?.value,
    ).toBe("writer");
  });

  it("keeps a new default-agent card visible in research scope before metadata loads", async () => {
    const created = createCanopyCard({ id: "created", title: "New default-agent work" });
    const client = createCanopyTestClient({ "canopy.cards.create": { card: created } });
    const { state, container, renderView } = createCanopyView({
      client,
      defaultAgentId: "research",
      scopeAgentId: "research",
    });
    state.cards = [
      createCanopyCard({ id: "assigned", title: "Assigned default work", agentId: "research" }),
      createCanopyCard({ id: "other", title: "Other agent work", agentId: "writer" }),
    ];
    renderView();
    textButton(container, "New card").click();
    renderView();
    const title = expectDefined(
      container.querySelector<HTMLInputElement>(".canopy-draft__title"),
      ".canopy-draft__title",
    );
    title.value = created.title;
    title.dispatchEvent(new InputEvent("input", { bubbles: true }));
    container
      .querySelector<HTMLFormElement>(".canopy-draft")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitForFast(() => expect(state.draftOpen).toBe(false));
    renderView();
    expect(client.request).toHaveBeenCalledWith(
      "canopy.cards.create",
      expect.objectContaining({ title: created.title, agentId: "" }),
    );
    expect(container.querySelector(".canopy-board")?.textContent).toContain(created.title);
    expect(container.querySelector(".canopy-board")?.textContent).not.toContain(
      "Other agent work",
    );
    statusButton(container, "Todo").click();
    renderView();
    statusButton(container, "All").click();
    renderView();
    expect(container.querySelector(".canopy-board")?.textContent).toContain(created.title);
    expect(container.querySelector(".canopy-board")?.textContent).toContain(
      "Assigned default work",
    );
  });

  it("reapplies card templates after editing their text fields", async () => {
    const client = createCanopyTestClient({
      "canopy.cards.create": { card: createCanopyCard({ title: "Release: " }) },
    });
    const { state, container, renderView } = createCanopyView({
      client,
      onRequestUpdate: () => undefined,
    });
    state.draftOpen = true;
    renderView();
    const template = textButton(container, "Release");
    const fields = [
      [".canopy-draft__title", "Release: "],
      [".canopy-draft__notes", "Scope:\nVerification:\nCloseout:"],
      [".canopy-draft__labels", "release"],
    ] as const;
    template.click();
    renderView();
    for (const [selector, value] of fields) {
      const input = expectDefined(
        container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector),
        selector,
      );
      expect(input.value).toBe(value);
      input.value = `Edited ${value}`;
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    template.click();
    renderView();
    for (const [selector, value] of fields) {
      expect(container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)?.value).toBe(
        value,
      );
    }
    container
      .querySelector<HTMLFormElement>(".canopy-draft")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await waitForFast(() => expect(state.draftOpen).toBe(false));
    expect(client.request).toHaveBeenCalledExactlyOnceWith(
      "canopy.cards.create",
      expect.objectContaining({
        title: "Release: ",
        notes: "Scope:\nVerification:\nCloseout:",
        labels: ["release"],
        priority: "urgent",
        templateId: "release",
      }),
    );
  });

  it("renders card event history", () => {
    const { state, container, renderView } = createCanopyView({
      onRequestUpdate: () => undefined,
    });
    state.cards = [
      createCanopyCard({
        title: "Tracked task",
        status: "review",
        updatedAt: 2,
        events: [
          { id: "event-1", kind: "moved", at: 1, fromStatus: "triage", toStatus: "backlog" },
          { id: "event-2", kind: "moved", at: 2, fromStatus: "backlog", toStatus: "todo" },
          { id: "event-3", kind: "moved", at: 3, fromStatus: "todo", toStatus: "scheduled" },
          { id: "event-4", kind: "moved", at: 4, fromStatus: "scheduled", toStatus: "ready" },
          { id: "event-5", kind: "moved", at: 5, fromStatus: "ready", toStatus: "running" },
          { id: "event-6", kind: "moved", at: 6, fromStatus: "running", toStatus: "review" },
          { id: "event-7", kind: "moved", at: 7, fromStatus: "review", toStatus: "done" },
        ],
      }),
    ];
    renderView();
    expect(container.querySelector(".canopy-events")).toBeNull();
    container
      .querySelector<HTMLButtonElement>('button[aria-label="View details"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    renderView();
    expect(container.querySelector(".canopy-detail")?.textContent).toContain("Moved to Done");
    expect(container.querySelector(".canopy-detail")?.textContent).toContain("Moved to Backlog");
  });

  it("renders card metadata badges and hides archived cards", () => {
    const { state, container, renderView } = createCanopyView();
    state.cards = [
      createCanopyCard({
        title: "Metadata rich",
        metadata: {
          templateId: "plugin",
          attempts: [{ id: "run-1", status: "blocked", startedAt: 1, endedAt: 2 }],
          failureCount: 1,
          comments: [{ id: "comment-1", body: "Needs owner check", createdAt: 3 }],
          links: [{ id: "link-1", type: "relates_to", url: "https://example.com", createdAt: 4 }],
          workerProtocol: {
            state: "blocked",
            detail: "Worker asked for owner input.",
            updatedAt: 12,
          },
          automation: {
            tenant: "ops",
            boardId: "quality",
            skills: ["review", "test"],
            workspace: { kind: "worktree", path: "/tmp/canopy", branch: "proof" },
            dispatchCount: 3,
            summary: "Ready for review.",
          },
          proof: Array.from({ length: 7 }, (_, index) => ({
            id: `proof-${index + 1}`,
            status: "passed",
            command: `pnpm test ${index + 1}`,
            url: `https://example.com/proof-${index + 1}`,
            createdAt: 5 + index,
          })),
          stale: { detectedAt: 6, reason: "No recent activity." },
        },
      }),
      createCanopyCard({
        id: "card-2",
        title: "Archived task",
        position: 2000,
        metadata: { archivedAt: 7 },
      }),
    ];
    renderView();
    expect(container.querySelector(".canopy-card")?.textContent).not.toContain("Plugin");
    expect(
      container.querySelector('.canopy-card__counts [aria-label="1 failed"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('.canopy-card__counts [aria-label="1 comments"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('.canopy-card__counts [aria-label="7 proof"]'),
    ).not.toBeNull();
    expect(container.querySelector(".canopy-card__alert")?.textContent).toContain("Stale");
    expect(container.querySelector(".canopy-card__alert")?.getAttribute("title")).toContain(
      "No recent activity.",
    );
    expect(container.textContent).not.toContain("Archived task");
    const archivedToggle = expectDefined(
      container.querySelector<HTMLInputElement>('.canopy-filter-archived input[role="switch"]'),
      '.canopy-filter-archived input[role="switch"]',
    );
    archivedToggle.checked = true;
    archivedToggle.dispatchEvent(new Event("change", { bubbles: true }));
    renderView();
    expect(container.textContent).toContain("Archived task");
    expect(archivedToggle.checked).toBe(true);
    container
      .querySelector<HTMLButtonElement>('button[aria-label="View details"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    renderView();
    expect(container.querySelector(".canopy-detail")?.textContent).toContain("1 attempts");
    expect(container.querySelector(".canopy-detail")?.textContent).toContain("1 links");
    expect(container.querySelector(".canopy-detail")?.textContent).toContain("pnpm test 1");
    expect(container.querySelector(".canopy-detail")?.textContent).toContain("pnpm test 7");
    expect(container.querySelector(".canopy-detail")?.textContent).toContain(
      "https://example.com/proof-7",
    );
    expect(container.querySelector(".canopy-detail")?.textContent).toContain("Worker protocol");
    expect(container.querySelector(".canopy-detail")?.textContent).toContain(
      "Worker asked for owner input.",
    );
    expect(container.querySelector(".canopy-detail")?.textContent).toContain("Card automation");
    expect(container.querySelector(".canopy-detail")?.textContent).toContain("ops");
    expect(container.querySelector(".canopy-detail")?.textContent).toContain("review, test");
    expect(container.querySelector(".canopy-detail")?.textContent).toContain(
      "worktree · /tmp/canopy · proof",
    );
  });

  it("filters cards by persisted boards and keeps empty archived boards selectable", () => {
    const onBoardFilterChange = vi.fn();
    const { state, container, renderView } = createCanopyView({ onBoardFilterChange });
    state.boards = [
      { id: "default", total: 1, active: 1, archived: 0, byStatus: { todo: 1 } },
      { id: "ops", name: "Operations", total: 1, active: 1, archived: 0, byStatus: { todo: 1 } },
      {
        id: "archive",
        name: "Old work",
        total: 0,
        active: 0,
        archived: 0,
        byStatus: {},
        archivedAt: 7,
      },
    ];
    state.cards = [
      createCanopyCard({ id: "card-default", title: "Default work" }),
      createCanopyCard({
        id: "card-ops",
        title: "Ops work",
        position: 2000,
        metadata: { automation: { boardId: "ops" } },
      }),
    ];
    renderView();
    const boardFilter = filterPicker(container, "Filter by board");
    expect(boardFilter.options.map((option) => option.label)).toEqual(
      expect.arrayContaining(["Default board", "Operations (ops)", "Old work (archive)"]),
    );
    boardFilter.onSelect("ops");
    renderView();
    expect(onBoardFilterChange).toHaveBeenCalledWith("ops");
    expect(container.textContent).not.toContain("Default work");
    expect(container.textContent).toContain("Ops work");
  });

  it("filters cards by linked agent", () => {
    const agentsList: NonNullable<CanopyRenderProps["agentsList"]> = {
      defaultId: "main",
      agents: [
        { id: "main", name: "Main" },
        { id: "ops", name: "Ops" },
      ],
    };
    const { state, container, renderView } = createCanopyView({ agentsList });
    state.cards = [
      createCanopyCard({ title: "Main work", agentId: "main" }),
      createCanopyCard({ id: "card-2", title: "Ops work", agentId: "ops", position: 2000 }),
      createCanopyCard({
        id: "card-3",
        title: "Dispatcher work",
        agentId: "canopy-dispatcher",
        position: 3000,
      }),
    ];
    renderView();
    const agentFilter = filterPicker(container, "Agent");
    for (const label of [
      "All agents",
      "Unassigned (uses Main)",
      "Main (default)",
      "Ops",
      "canopy-dispatcher (not configured)",
    ]) {
      expect(agentFilter.options.map((option) => option.label)).toContain(label);
    }
    agentFilter.onSelect("ops");
    renderView();
    expect(container.textContent).not.toContain("Main work");
    expect(container.textContent).toContain("Ops work");
    expect(state.agentFilter).toBe("ops");
    filterPicker(container, "Agent").onSelect("canopy-dispatcher");
    renderView();
    expect(container.textContent).not.toContain("Ops work");
    expect(container.textContent).toContain("Dispatcher work");
    expect(state.agentFilter).toBe("canopy-dispatcher");
  });

  it("limits assignment choices to configured agents and preserves an unknown current assignee", () => {
    const { state, container, renderView } = createCanopyView({
      agentsList: {
        defaultId: "main",
        agents: [
          { id: "main", name: "Main" },
          { id: "main", name: "Main duplicate" },
          { id: "ops", name: "Ops" },
        ],
      },
    });
    state.draftOpen = true;
    state.draftTitle = "Assign me";
    state.draftAgentId = "canopy-dispatcher";
    state.cards = [createCanopyCard({ title: "Assign me", agentId: "canopy-dispatcher" })];
    renderView();
    const draft = container.querySelector<HTMLElement>(".canopy-draft");
    const agentSelect = expectDefined(
      draft?.querySelector<AgentPicker>(".canopy-agent-select [data-test-agent-picker]"),
      ".canopy-agent-select [data-test-agent-picker]",
    );
    expect(agentSelect?.options.map((option) => option.label)).toEqual([
      "Main",
      "Main",
      "Ops",
      "canopy-dispatcher (not configured)",
    ]);
    expect(agentSelect?.options.find((option) => option.label === "Main")?.badge).toBe("Default");
    expect(agentSelect?.options.find((option) => option.label === "Ops")?.badge).toBeUndefined();
    expect(agentSelect.options.find((option) => option.value === "main")?.badge).toBeUndefined();
    agentSelect.onSelect("");
    renderView();
    expect(state.draftAgentId).toBe("");
    expect(agentSelect.value).toBe("");
  });

  it("keeps inherited detail assignment current across default and connection changes", async () => {
    const card = createCanopyCard({ agentId: "ops" });
    const client = createCanopyTestClient({
      "canopy.cards.update": { card: createCanopyCard({ updatedAt: 2 }) },
    });
    const agents = [
      { id: "main", name: "Main" },
      { id: "ops", name: "Ops" },
    ];
    const { state, container, renderView } = createCanopyView({
      client,
      agentsList: { defaultId: "main", agents },
    });
    state.cards = [card];
    state.detailCardId = card.id;
    renderView();
    const picker = expectDefined(
      container.querySelector<AgentPicker>(
        ".canopy-detail__agent-picker [data-test-agent-picker]",
      ),
      ".canopy-detail__agent-picker [data-test-agent-picker]",
    );
    expect(picker.options.find((option) => option.value === "")).toMatchObject({
      label: "Main",
      badge: "Default",
    });
    picker.onSelect("");
    await vi.waitFor(() => expect(state.cards[0]?.agentId).toBeUndefined());
    expect(client.request).toHaveBeenCalledWith("canopy.cards.update", {
      id: card.id,
      expectedUpdatedAt: card.updatedAt,
      patch: { agentId: "" },
    });
    renderView({ agentsList: { defaultId: "ops", agents } });
    expect(picker.value).toBe("");
    expect(picker.options.find((option) => option.value === picker.value)).toMatchObject({
      label: "Ops",
      badge: "Default",
    });
    renderView({ connected: false });
    expect(picker.disabled).toBe(true);
    renderView({ client: null });
    expect(picker.disabled).toBe(true);
    renderView();
    expect(picker.disabled).toBe(false);
  });

  it("preflights model-specific starts for ACP runtime agents", () => {
    const { state, container, renderView } = createCanopyView({
      agentsList: {
        defaultId: "main",
        agents: [{ id: "main", name: "Main", agentRuntime: { id: "codex", source: "agent" } }],
      },
    });
    state.detailCardId = "card-1";
    state.cards = [createCanopyCard({ title: "ACP-backed work", agentId: "main" })];
    renderView();
    const engineButtons = [
      ...container.querySelectorAll<HTMLButtonElement>(
        ".canopy-detail .canopy-card__start:not(.canopy-card__start--default)",
      ),
    ];
    expect(engineButtons).toHaveLength(4);
    expect(engineButtons.every((button) => button.disabled)).toBe(true);
    expect(engineButtons[0]?.getAttribute("aria-label")).toContain("uses the codex ACP runtime");
  });

  it("keeps visible archived cards inspectable and restorable without move or drag controls", async () => {
    const archivedCard = createCanopyCard({
      title: "Archived historical task",
      metadata: { archivedAt: 10 },
    });
    const request = vi.fn();
    const { state, container, renderView } = createCanopyView({
      client: { request } as unknown as GatewayBrowserClient,
    });
    state.cards = [archivedCard];
    state.showArchived = true;
    renderView();
    const article = container.querySelector<HTMLElement>(".canopy-card--archived");
    expect(article).not.toBeNull();
    expect(article?.getAttribute("draggable")).toBe("false");
    expect(article?.querySelector(".canopy-card__move-select")).toBeNull();
    expect(buttonByLabel(article!, "Restore from archive")).not.toBeNull();
    expect(
      article!.dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true })),
    ).toBe(false);
    expect(state.draggedCardId).toBeNull();
    state.draggedCardId = archivedCard.id;
    container
      .querySelector(".canopy-column--running")
      ?.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
    expect(request).not.toHaveBeenCalled();
    state.draggedCardId = null;
    state.detailCardId = archivedCard.id;
    renderView();
    const drawer = container.querySelector<HTMLElement>(".canopy-detail");
    await expectDefined(
      drawer?.querySelector<LitElement>("canopy-inline-text"),
      "canopy-inline-text",
    ).updateComplete;
    expect(drawer?.textContent).toContain(archivedCard.title);
    expect(drawer?.querySelector(".canopy-card__move-select")).toBeNull();
    expect(buttonByLabel(drawer!, "Restore from archive")).not.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("shows stale lifecycle on executed linked cards", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(60 * 60 * 1000);
    try {
      const { host, state } = createLoadedCanopyState();
      state.cards = [
        createCanopyCard({
          title: "Watch stale run",
          status: "running",
          execution: {
            id: "exec-1",
            kind: "agent-session",
            engine: "codex",
            mode: "autonomous",
            status: "running",
            model: "openai/gpt-5.5",
            sessionKey: "agent:main:dashboard:1",
            startedAt: 1,
            updatedAt: 1,
          },
        }),
      ];
      const { container, renderView } = createCanopyView(
        {
          sessions: [
            {
              key: "agent:main:dashboard:1",
              kind: "direct",
              displayName: "Dashboard session",
              updatedAt: 1,
              hasActiveRun: false,
              status: "running",
            },
          ],
        },
        host,
      );
      renderView();
      await vi.waitFor(() =>
        expect(
          container.querySelector(".canopy-session-status__trigger")?.textContent,
        ).toContain("Stale"),
      );
      expect(container.querySelector(".canopy-session-status__detail")?.textContent).toContain(
        "No recent session activity",
      );
      expect(container.querySelector(".canopy-card__session-marker")).toBeNull();
      expect(container.textContent).not.toContain("codex autonomous");
      expect(container.querySelector(".canopy-live")).toBeNull();
      expect(container.querySelector('button[aria-label="Stop session"]')).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it.each([
    {
      scenario: "an execution-owned linked session",
      sessionKey: "agent:main:execution-linked-session",
      topLevelSessionKey: undefined,
    },
    {
      scenario: "the authoritative top-level session",
      sessionKey: "agent:main:top-level-linked-session",
      topLevelSessionKey: "agent:main:top-level-linked-session",
    },
  ])("preserves $scenario when editing a Canopy card", async (testCase) => {
    const card = createCanopyCard({
      title: "Keep my linked session",
      ...(testCase.topLevelSessionKey ? { sessionKey: testCase.topLevelSessionKey } : {}),
      execution: createCanopyExecution({ sessionKey: "agent:main:execution-linked-session" }),
    });
    const request = vi.fn(async () => ({
      card: { ...card, title: "Renamed without unlinking", updatedAt: 2 },
    }));
    const { state, container, renderView } = createCanopyView({
      client: { request } as unknown as GatewayBrowserClient,
      onRequestUpdate: () => undefined,
      sessions: [
        {
          key: testCase.sessionKey,
          kind: "direct",
          displayName: "Active linked session",
          updatedAt: 1,
          status: "running",
        },
      ],
    });
    state.cards = [card];
    state.detailCardId = card.id;
    renderView();
    const editButton = buttonByLabel(container, "Edit card");
    expect(editButton).not.toBeNull();
    editButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    renderView();
    expect(state.draftSessionKey).toBe(testCase.sessionKey);
    expect(sessionPicker(container).value).toBe(testCase.sessionKey);
    const title = container.querySelector<HTMLInputElement>(".canopy-draft__title");
    expect(title).not.toBeNull();
    title!.value = "Renamed without unlinking";
    title!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    container
      .querySelector<HTMLFormElement>(".canopy-draft")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith("canopy.cards.update", {
      id: card.id,
      expectedUpdatedAt: card.updatedAt,
      patch: { title: "Renamed without unlinking" },
    });
    expect(state.cards[0]?.execution?.sessionKey).toBe("agent:main:execution-linked-session");
    renderView();
    state.detailTab = "session";
    renderView();
    expect(container.querySelector("[data-test-session-summary]")).not.toBeNull();
  });

  it.each(["title", "notes"] as const)(
    "preserves an inline %s draft through lost connectivity and client availability",
    async (field) => {
      const card = createCanopyCard({
        title: "Original title",
        notes: "Original notes",
        labels: ["original"],
      });
      const value = "Edited text";
      const patch = { [field]: value };
      const client = createCanopyTestClient(() => ({
        card: { ...card, ...patch, updatedAt: card.updatedAt + 1 },
      }));
      const { state, container, renderView } = createCanopyView({ client });
      state.cards = [card];
      state.detailCardId = card.id;
      renderView();
      const editor = await inlineEditor(container, field);
      const { owner } = editor;
      const input = await editor.open();
      input.value = value;
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      const save = textButton(owner, "Save");
      for (const unavailable of [
        { connected: false, client },
        { connected: true, client: null },
      ]) {
        renderView(unavailable);
        await waitForFast(() => {
          expect(input.disabled).toBe(true);
          expect(save.disabled).toBe(true);
        });
        expect(input.isConnected).toBe(true);
        expect(input.value).toBe(value);
        input.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
        );
        expect(client.request).not.toHaveBeenCalled();
      }
      renderView({ connected: true, client });
      await waitForFast(() => expect(save.disabled).toBe(false));
      expect(input.value).toBe(value);
      save.click();
      await waitForFast(() =>
        expect(client.request).toHaveBeenCalledWith("canopy.cards.update", {
          id: card.id,
          expectedUpdatedAt: card.updatedAt,
          patch,
        }),
      );
      await waitForFast(() => expect(state.cards[0]).toMatchObject(patch));
    },
  );

  it("resumes dirty labels after light dismissal and clears them only on explicit cancel", async () => {
    const card = createCanopyCard({ labels: ["original"] });
    const { state, container, renderView } = createCanopyView({
      client: createCanopyTestClient({}),
    });
    state.cards = [card];
    state.detailCardId = card.id;
    renderView();
    const editor = await inlineEditor(container, "labels");
    const { trigger } = editor;
    const popup = expectDefined(editor.popover, "labels popover");
    const matches = vi.spyOn(popup, "matches").mockReturnValue(false);
    onTestFinished(() => matches.mockRestore());
    const input = await editor.open();
    input.value = "original, pending";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    popup.dispatchEvent(new Event("toggle"));
    await waitForFast(() => expect(popup.querySelector("input")).toBeNull());
    trigger.click();
    await waitForFast(() =>
      expect(popup.querySelector<HTMLInputElement>("input")?.value).toBe("original, pending"),
    );
    textButton(popup, "Cancel").click();
    await waitForFast(() => expect(popup.querySelector("input")).toBeNull());
    trigger.click();
    await waitForFast(() =>
      expect(popup.querySelector<HTMLInputElement>("input")?.value).toBe("original"),
    );
    expect(state.cards[0]?.labels).toEqual(["original"]);
  });

  it.each([
    { field: "title", change: "permission", dismiss: "none" },
    { field: "notes", change: "archive", dismiss: "none" },
    { field: "labels", change: "permission", dismiss: "before" },
    { field: "labels", change: "archive", dismiss: "after" },
  ] as const)(
    "retains dirty inline $field when live $change removes editability (dismiss=$dismiss)",
    async ({ field, change, dismiss }) => {
      const card = createCanopyCard({ title: "Original", notes: "Original", labels: [] });
      const client = createCanopyTestClient({});
      let canWrite = true;
      const { state, container, renderView } = createCanopyView({
        client,
        onRequestUpdate: () => renderView({ canWrite }),
      });
      state.cards = [card];
      state.detailCardId = card.id;
      state.showArchived = false;
      renderView({ canWrite });
      const editor = await inlineEditor(container, field);
      const { trigger, owner, popover } = editor;
      let input = await editor.open();
      input.value = "Unsaved change";
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      const dismissLabels = async () => {
        expectDefined(popover, "labels popover").dispatchEvent(new Event("toggle"));
        await waitForFast(() => expect(owner.querySelector("input")).toBeNull());
      };
      if (dismiss === "before") {
        await dismissLabels();
      }
      if (change === "permission") {
        canWrite = false;
      } else {
        state.cards = [{ ...card, metadata: { ...card.metadata, archivedAt: 1 } }];
      }
      renderView({ canWrite });
      if (dismiss === "after") {
        await waitForFast(() => expect(input.readOnly).toBe(true));
        await dismissLabels();
      }
      if (dismiss !== "none") {
        await waitForFast(() => expect(trigger.disabled).toBe(false));
        trigger.click();
        input = await waitForFast(() =>
          expectDefined(owner.querySelector<HTMLInputElement>("input"), "input"),
        );
      }
      await waitForFast(() => expect(input.readOnly).toBe(true));
      expect(input.disabled).toBe(false);
      expect(input.isConnected).toBe(true);
      expect(input.value).toBe("Unsaved change");
      expect(owner.querySelector("input, textarea")).toBe(input);
      const save = textButton(owner, "Save");
      expect(save.disabled).toBe(true);
      save.click();
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
      expect(client.request).not.toHaveBeenCalled();
      const close = expectDefined(
        container.querySelector<HTMLButtonElement>(".canopy-detail__close"),
        ".canopy-detail__close",
      );
      close.click();
      expect(state.detailCardId).toBe(card.id);
      expect(input.isConnected).toBe(true);
      textButton(container.querySelector(".canopy-discard")!, "Keep editing").click();
      expect(input.value).toBe("Unsaved change");
      expect(input.readOnly).toBe(true);
      expect(input.disabled).toBe(false);
      close.click();
      textButton(container.querySelector(".canopy-discard")!, "Discard").click();
      expect(state.detailCardId).toBeNull();
      expect(input.isConnected).toBe(false);
      expect(client.request).not.toHaveBeenCalled();
    },
  );

  it("preserves explicit archive visibility (success=true, showArchived=false)", async () => {
    const card = createCanopyCard({ title: "Archive from drawer", notes: "", labels: [] });
    const client = createCanopyTestClient(() => {
      return { card: { ...card, metadata: { ...card.metadata, archivedAt: 2 } } };
    });
    const { state, container, renderView } = createCanopyView({
      client,
      onRequestUpdate: () => renderView(),
    });
    state.cards = [card];
    state.detailCardId = card.id;
    state.showArchived = false;
    renderView();
    requireButton(container.querySelector(".canopy-detail__menu")!, "Archive card").click();
    await waitForFast(() => expect(state.busyCardIds.size).toBe(0));
    expect(client.request).toHaveBeenCalledWith("canopy.cards.archive", {
      id: card.id,
      archived: true,
    });
    expect(container.querySelector(".canopy-detail")).toBeNull();
  });

  it.each([
    { field: "priority", original: "normal", next: "high" },
    { field: "status", original: "todo", next: "ready" },
  ] as const)(
    "restores native $field selection after rejection so the same option can retry",
    async ({ field, original, next }) => {
      const card = createCanopyCard({ priority: "normal", status: "todo" });
      let attempts = 0;
      let canonical = card;
      const mutationMethod = field === "status" ? "canopy.cards.move" : "canopy.cards.update";
      const client = createCanopyTestClient((method) => {
        if (method === "canopy.cards.list") {
          return { cards: [canonical], boards: [] };
        }
        if (method !== mutationMethod) {
          throw new Error(`Unexpected request: ${method}`);
        }
        attempts += 1;
        if (attempts === 1) {
          canonical = { ...card, updatedAt: card.updatedAt + 1 };
          throw new GatewayProtocolRequestError({
            code: "canopy_conflict",
            message: "Review and retry the property.",
            details: { type: "canopy_card_conflict", card: canonical },
          });
        }
        canonical = { ...card, [field]: next, updatedAt: card.updatedAt + 2 };
        return { card: canonical };
      });
      const { state, container, renderView } = createCanopyView({
        client,
        onRequestUpdate: () => renderView(),
      });
      state.cards = [card];
      state.detailCardId = card.id;
      renderView();
      const propertyOption = (value: string) =>
        expectDefined(
          container.querySelector<HTMLInputElement>(
            `[name="canopy-detail-${field}-${card.id}"][value="${value}"]`,
          ),
          `[name="canopy-detail-${field}-${card.id}"][value="${value}"]`,
        );
      propertyOption(next).click();
      await waitForFast(() => expect(state.error).toContain("Review and retry"));
      await waitForFast(() => {
        expect(state.loading).toBe(false);
        expect(state.mutationReadiness).toBe("ready");
        expect(propertyOption(next).disabled).toBe(false);
      });
      const choice = propertyOption(next);
      const prior = propertyOption(original);
      expect(attempts).toBe(1);
      expect(state.cards[0]?.[field]).toBe(original);
      expect(choice.checked).toBe(false);
      expect(prior.checked).toBe(true);
      choice.click();
      await waitForFast(() => expect(state.cards[0]?.[field]).toBe(next));
      expect(attempts).toBe(2);
      expect(choice.checked).toBe(true);
    },
  );

  it("guards automation navigation while keeping modified clicks native", async () => {
    const card = createCanopyCard({ title: "Draft automation card" });
    const { state, container, renderView } = createCanopyView({
      client: createCanopyTestClient({}),
      onRequestUpdate: () => renderView(),
      detailBoardAutomation: {
        jobId: "job-review",
        status: "loaded",
        job: {
          id: "job-review",
          name: "Review board",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 60000 },
          sessionTarget: "isolated",
          wakeMode: "now",
          payload: { kind: "agentTurn", message: "Review the board" },
          state: {},
        },
      },
    });
    state.cards = [card];
    state.detailCardId = card.id;
    renderView();
    const link = expectDefined(
      container.querySelector<HTMLAnchorElement>('.canopy-detail a[href*="/automations?job="]'),
      '.canopy-detail a[href*="/automations?job="]',
    );
    const allowed: boolean[] = [];
    link.addEventListener("click", (event) => {
      allowed.push(!event.defaultPrevented);
      event.preventDefault(); // Record navigation admission without leaving the test page.
    });
    const click = (init: MouseEventInit = {}) =>
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...init }));
    click();
    expect(allowed).toEqual([true]);
    const trigger = await waitForFast(() =>
      expectDefined(
        container.querySelector<HTMLButtonElement>(".canopy-detail__text-trigger--title"),
        ".canopy-detail__text-trigger--title",
      ),
    );
    trigger.click();
    const input = await waitForFast(() =>
      expectDefined(
        container.querySelector<HTMLInputElement>(".canopy-detail__text-editor--title input"),
        ".canopy-detail__text-editor--title input",
      ),
    );
    input.value = "Unsaved title";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    for (const modifier of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      click(modifier);
      expect(allowed.at(-1)).toBe(true);
      expect(container.querySelector(".canopy-discard")).toBeNull();
    }
    click();
    expect(allowed.at(-1)).toBe(false);
    expect(input.isConnected).toBe(true);
    textButton(container.querySelector(".canopy-discard")!, "Keep editing").click();
    expect(input.value).toBe("Unsaved title");
    click();
    expect(allowed.at(-1)).toBe(false);
    textButton(container.querySelector(".canopy-discard")!, "Discard").click();
    expect(allowed.at(-1)).toBe(true);
    expect(allowed.filter(Boolean)).toHaveLength(6);
  });

  it("keeps label pills mounted while editing and preserves failed input until Escape", async () => {
    const card = createCanopyCard({ title: "Label editing", labels: ["review"] });
    const client = createCanopyTestClient(() => {
      throw new Error("Labels unavailable");
    });
    const { state, container, renderView } = createCanopyView({
      client,
      onRequestUpdate: () => renderView(),
    });
    state.cards = [card];
    state.detailCardId = card.id;
    renderView();
    await waitForFast(() =>
      expect(container.querySelector(".canopy-detail__labels-popover")).not.toBeNull(),
    );
    const popup = expectDefined(
      container.querySelector<HTMLElement>(".canopy-detail__labels-popover"),
      ".canopy-detail__labels-popover",
    );
    // Native top-layer geometry is covered in the browser; this suite covers editor ownership.
    popup.showPopover = vi.fn();
    const trigger = expectDefined(
      container.querySelector<HTMLButtonElement>(".canopy-detail__text-trigger--labels"),
      ".canopy-detail__text-trigger--labels",
    );
    trigger.click();
    await waitForFast(() => expect(popup.querySelector("input")).not.toBeNull());
    expect(trigger.isConnected).toBe(true);
    expect(trigger.textContent).toContain("review");
    const input = expectDefined(popup.querySelector<HTMLInputElement>("input"), "input");
    input.value = " review, quality, review ";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    buttonByText(popup, "Save")!.click();
    await waitForFast(() => expect(state.error).toContain("Labels unavailable"));
    expect(client.request).toHaveBeenCalledWith("canopy.cards.update", {
      id: card.id,
      expectedUpdatedAt: card.updatedAt,
      patch: { labels: ["review", "quality"] },
    });
    expect(input.value).toBe(" review, quality, review ");
    expect(trigger.isConnected).toBe(true);
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    input.dispatchEvent(escape);
    await waitForFast(() => expect(popup.querySelector("input")).toBeNull());
    expect(escape.defaultPrevented).toBe(true);
    expect(state.detailCardId).toBe(card.id);
    expect(state.cards[0]?.labels).toEqual(["review"]);
    expect(document.activeElement).toBe(trigger);
  });

  it("opens an edit modal and submits card updates", async () => {
    const { host, state } = createLoadedCanopyState();
    state.cards = [
      createCanopyCard({
        title: "Rename me",
        notes: "Old notes",
        labels: ["ui"],
        metadata: { comments: [{ id: "comment-1", body: "Needs owner check", createdAt: 2 }] },
      }),
    ];
    const request = vi.fn(async (method: string) =>
      method === "canopy.cards.comment"
        ? {
            card: {
              ...state.cards[0],
              updatedAt: 2,
              metadata: {
                comments: [
                  ...(state.cards[0]?.metadata?.comments ?? []),
                  { id: "comment-2", body: "Ship after CI", createdAt: 3 },
                ],
              },
            },
          }
        : { card: { ...state.cards[0], title: "Renamed", priority: "high", updatedAt: 3 } },
    );
    const props = createCanopyRenderProps(host, {
      client: { request } as unknown as GatewayBrowserClient,
      onRequestUpdate: () => undefined,
    });
    const container = document.createElement("div");
    renderInto(container, props);
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Edit card"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    renderInto(container, props);
    expect(container.querySelector("[data-test-dialog]")?.textContent).toContain("Edit card");
    expect(container.querySelector("[data-test-dialog]")?.textContent).toContain(
      "Needs owner check",
    );
    const title = container.querySelector<HTMLInputElement>(".canopy-draft__title");
    expect(title?.value).toBe("Rename me");
    title!.value = "Renamed";
    title!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    const commentInput = container.querySelector<HTMLTextAreaElement>(".canopy-comments__input");
    commentInput!.value = "Ship after CI";
    commentInput!.dispatchEvent(new InputEvent("input", { bubbles: true }));
    renderInto(container, props);
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Create"))
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith("canopy.cards.comment", {
      id: "card-1",
      body: "Ship after CI",
    });
    expect(state.cards[0]?.metadata?.comments?.at(-1)?.body).toBe("Ship after CI");
    renderInto(container, props);
    expect(container.querySelector<HTMLInputElement>(".canopy-draft__title")?.value).toBe(
      "Renamed",
    );
    expect(state.editingCardBase?.updatedAt).toBe(2);
    const priority = expectDefined(
      container.querySelector<HTMLInputElement>(
        '.canopy-draft input[name="priority"][value="high"]',
      ),
      '.canopy-draft input[name="priority"][value="high"]',
    );
    priority.click();
    container
      .querySelector<HTMLFormElement>(".canopy-draft")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(request).toHaveBeenCalledWith("canopy.cards.update", {
      id: "card-1",
      expectedUpdatedAt: 2,
      patch: { title: "Renamed", priority: "high" },
    });
    expect(
      request.mock.calls.filter(([method]) => method === "canopy.cards.update"),
    ).toHaveLength(1);
    expect(state.cards[0]).toMatchObject({ title: "Renamed", priority: "high", updatedAt: 3 });
    renderInto(container, props);
    expect(container.querySelector("[data-test-dialog]")).toBeNull();
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Edit card"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    renderInto(container, props);
    expect(container.querySelector<HTMLInputElement>(".canopy-draft__title")?.value).toBe(
      "Renamed",
    );
    expect(container.querySelector<HTMLInputElement>('input[name="priority"]:checked')?.value).toBe(
      "high",
    );
  });

  it.each(["create", "conflict"] as const)(
    "shows %s failure inside the active card editor and preserves retryable input",
    async (operation) => {
      const card = createCanopyCard({ title: "Original title", notes: "Original notes" });
      const current = { ...card, priority: "high" as const, updatedAt: 2 };
      const message =
        operation === "conflict" ? "Card changed. Review and retry." : `${operation} unavailable`;
      const error =
        operation === "conflict"
          ? new GatewayProtocolRequestError({
              code: "canopy_conflict",
              message,
              details: { type: "canopy_card_conflict", card: current },
            })
          : new Error(message);
      const method = operation === "create" ? "canopy.cards.create" : "canopy.cards.update";
      const saved = { ...current, title: "Unsaved title", notes: "Unsaved notes", updatedAt: 3 };
      const client = createCanopyTestClient({ [method]: { card: saved } });
      client.request.mockImplementationOnce(async () => {
        throw error;
      });
      const { state, container, renderView } = createCanopyView({ client });
      state.cards = operation === "create" ? [] : [card];
      renderView();
      expectDefined(
        operation === "create"
          ? buttonByText(container, "New card")
          : buttonByLabel(container, "Edit card"),
        "open card editor",
      ).click();
      renderView();
      const inputs: [string, string][] = [
        [".canopy-draft__title", "Unsaved title"],
        [".canopy-draft__notes", "Unsaved notes"],
      ];
      for (const [selector, value] of inputs) {
        const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
        input.value = value;
        input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      }
      const submit = () => {
        container
          .querySelector<HTMLFormElement>(".canopy-draft")!
          .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      };
      submit();
      await waitForFast(() => expect(state.error).toContain(message));
      renderView();
      expect(client.request).toHaveBeenCalledWith(method, expect.anything());
      const errorToast = toast(container.querySelector("[data-test-dialog]")!);
      await waitForFast(() =>
        expect(errorToast.shadowRoot?.querySelector('[role="alert"]')).not.toBeNull(),
      );
      const alert = expectDefined(
        errorToast.shadowRoot?.querySelector<HTMLElement>('[role="alert"]'),
        '[role="alert"]',
      );
      expect(alert.textContent).toContain(message);
      expect(alert.closest('[inert], [aria-hidden="true"]')).toBeNull();
      expect(errorToast.closest('[inert], [aria-hidden="true"]')).toBeNull();
      expect(container.querySelector<HTMLInputElement>(".canopy-draft__title")?.value).toBe(
        "Unsaved title",
      );
      expect(container.querySelector<HTMLTextAreaElement>(".canopy-draft__notes")?.value).toBe(
        "Unsaved notes",
      );
      if (operation === "conflict") {
        expect(alert.textContent).toContain("Your unsaved edits remain in the form.");
        expect(
          container.querySelector<HTMLInputElement>('input[name="priority"]:checked')?.value,
        ).toBe("high");
      }
      submit();
      await waitForFast(() => {
        expect(state.draftSaving).toBe(false);
        expect(state.busyCardIds.size).toBe(0);
      });
      renderView();
      expect(client.request).toHaveBeenCalledTimes(2);
      expect(state.error).toBeNull();
      expect(state.draftOpen).toBe(false);
    },
  );

  it("shows a failed note inside the active detail drawer and allows retry", async () => {
    const card = createCanopyCard({ title: "Review this card" });
    const body = "Keep this note until it saves.";
    const client = createCanopyTestClient({
      "canopy.cards.comment": {
        card: { ...card, metadata: { comments: [{ id: "note", body, createdAt: 2 }] } },
      },
    });
    client.request.mockImplementationOnce(async () => {
      throw new Error("Note unavailable");
    });
    const { state, container, renderView } = createCanopyView({ client });
    state.cards = [card];
    renderView();
    requireButton(container, "View details").click();
    state.detailTab = "activity";
    renderView();
    const note = container.querySelector<HTMLTextAreaElement>(".canopy-detail__note")!;
    note.value = body;
    note.dispatchEvent(new InputEvent("input", { bubbles: true }));
    renderView();
    textButton(container, "Add note").click();
    await waitForFast(() => expect(state.error).toBe("Note unavailable"));
    renderView();
    const errorToast = toast(container.querySelector("[data-test-dialog]")!);
    await waitForFast(() =>
      expect(errorToast.shadowRoot?.querySelector('[role="alert"]')).not.toBeNull(),
    );
    const alert = expectDefined(
      errorToast.shadowRoot?.querySelector<HTMLElement>('[role="alert"]'),
      '[role="alert"]',
    );
    expect(alert.textContent).toContain("Note unavailable");
    expect(alert.closest('[inert], [aria-hidden="true"]')).toBeNull();
    expect(errorToast.closest('[inert], [aria-hidden="true"]')).toBeNull();
    expect(note.value).toBe(body);
    textButton(container, "Add note").click();
    await waitForFast(() => expect(state.busyCardIds.size).toBe(0));
    renderView();
    expect(client.request).toHaveBeenCalledTimes(2);
    expect(state.error).toBeNull();
    expect(container.querySelector(".canopy-detail__comments")?.textContent).toContain(body);
    expect(note.value).toBe("");
  });

  it("preserves a pending details note across close and clears it after successful submission", async () => {
    const card = createCanopyCard({ title: "Investigate proof gap", status: "review" });
    const comment = { id: "comment-1", body: "Need Linux proof.", createdAt: 2 };
    const pending = createDeferred<{
      card: typeof card;
    }>();
    const client = createCanopyTestClient(() => pending.promise);
    const { state, container, renderView } = createCanopyView({ client });
    state.cards = [card];
    renderView();
    buttonByLabel(container, "View details")!.click();
    renderView();
    state.detailTab = "activity";
    renderView();
    const note = expectDefined(
      container.querySelector<HTMLTextAreaElement>(".canopy-detail__note"),
      ".canopy-detail__note",
    );
    note.value = ` ${comment.body} `;
    note.dispatchEvent(new InputEvent("input", { bubbles: true }));
    renderView();
    buttonByText(container, "Add note")!.click();
    renderView();
    expect(note.disabled).toBe(true);
    buttonByLabel(container.querySelector(".canopy-detail")!, "Close")!.click();
    renderView();
    buttonByLabel(container, "View details")!.click();
    renderView();
    expect(state.detailCommentBody).toBe(` ${comment.body} `);
    pending.resolve({ card: { ...card, metadata: { comments: [comment] } } });
    await waitForFast(() => expect(state.busyCardIds.size).toBe(0));
    renderView();
    expect(client.request).toHaveBeenCalledWith("canopy.cards.comment", {
      id: card.id,
      body: comment.body,
    });
    expect(container.querySelector(".canopy-detail__comments")?.textContent).toContain(
      comment.body,
    );
    expect(state.detailCommentBody).toBe("");
    expect(state.detailCommentDrafts.has(card.id)).toBe(false);
  });

  it("keeps another card's editor draft when an earlier note finishes", async () => {
    const first = createCanopyCard({ title: "First card" });
    const second = createCanopyCard({ id: "card-2", title: "Second card" });
    const body = "Review this card.";
    const pending = createDeferred<{
      card: typeof first;
    }>();
    const client = createCanopyTestClient(() => pending.promise);
    const { state, container, renderView } = createCanopyView({ client });
    state.cards = [first, second];
    renderView();
    const editCard = (title: string) => {
      const card = expectDefined(
        [...container.querySelectorAll("article.canopy-card")].find(
          (candidate) => candidate.querySelector("h3")?.textContent === title,
        ),
        "card to edit",
      );
      requireButton(card, "Edit card").click();
      renderView();
    };
    const typeNote = () => {
      const input = expectDefined(
        container.querySelector<HTMLTextAreaElement>(".canopy-comments__input"),
        ".canopy-comments__input",
      );
      input.value = body;
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return input;
    };
    editCard(first.title);
    typeNote();
    expectDefined(
      container.querySelector<HTMLButtonElement>(".canopy-comments__submit"),
      ".canopy-comments__submit",
    ).click();
    renderView();
    requireButton(container, "Cancel").click();
    renderView();
    editCard(second.title);
    const nextNote = typeNote();
    renderView();
    pending.resolve({
      card: { ...first, metadata: { comments: [{ id: "note-1", body, createdAt: 2 }] } },
    });
    await waitForFast(() => expect(state.busyCardIds.size).toBe(0));
    renderView();
    expect(state.editingCardId).toBe(second.id);
    expect(state.draftCommentBody).toBe(body);
    expect(nextNote.value).toBe(body);
    expect(
      container.querySelector<HTMLButtonElement>(".canopy-comments__submit")?.disabled,
    ).toBe(false);
    expect(state.cards.find((card) => card.id === first.id)?.metadata?.comments?.[0]?.body).toBe(
      body,
    );
  });

  it("offers existing sessions when creating a card", () => {
    const { host, state } = createLoadedCanopyState();
    state.draftOpen = true;
    const container = document.createElement("div");
    render(
      renderCanopy(
        createCanopyRenderProps(host, {
          sessions: [
            {
              key: "agent:main:dashboard:1",
              kind: "direct",
              displayName: "Existing session",
              updatedAt: 2,
            },
            createGatewaySession({ key: "global", kind: "global", agentId: "main" }),
            createGatewaySession({ key: "unknown", kind: "unknown", agentId: "main" }),
            createGatewaySession({ key: "agent:writer:unknown", agentId: "writer" }),
          ],
        }),
      ),
      container,
    );
    const picker = sessionPicker(container);
    expect(picker.options.map((option) => option.label)).toContain("No linked session");
    expect(picker.options.map((option) => option.label)).toContain("Existing session");
    expect(picker.options.map((option) => option.value)).toEqual([
      "",
      "agent:main:dashboard:1",
      "agent:writer:unknown",
    ]);
  });

  it("shows a missing current session key instead of a false empty selection", () => {
    const { host, state } = createLoadedCanopyState();
    state.draftOpen = true;
    state.draftSessionKey = "agent:main:archived-session";
    const container = document.createElement("div");
    renderInto(container, createCanopyRenderProps(host));
    const picker = sessionPicker(container);
    expect(picker.value).toBe("agent:main:archived-session");
    expect(picker.options).toContainEqual({
      value: "agent:main:archived-session",
      label: "agent:main:archived-session",
    });
  });
});
/* oxlint-disable max-lines -- TODO: split this grandfathered oversized file. */
