// @vitest-environment node
import "../../test/host.setup.ts";
import { describe, expect, it } from "vitest";
import { getCanopyLifecycle } from "./lifecycle.ts";
import { loadCanopy, refreshCanopy } from "./loading.ts";
import { getCanopyState, resetCanopyConnectionState } from "./runtime.ts";
import {
  createGatewaySession,
  createCanopyCard,
  createCanopyTestClient,
} from "./test/index-helpers.ts";

describe("Canopy native owners", () => {
  it("loads canonical cards without querying a task ledger", async () => {
    const host = {};
    const card = createCanopyCard();
    const client = createCanopyTestClient({
      "canopy.cards.list": { cards: [card], boards: [] },
    });
    expect(await loadCanopy({ host, client })).toBe(true);
    expect(getCanopyState(host).cards).toEqual([card]);
    expect(client.request.mock.calls.map(([method]) => method)).toEqual(["canopy.cards.list"]);
  });

  it("refreshes server diagnostics before reading cards", async () => {
    const host = {};
    const client = createCanopyTestClient({ "canopy.cards.list": { cards: [], boards: [] } });
    expect(
      await refreshCanopy({ host, client, source: "manual", refreshDiagnostics: true }),
    ).toBe(true);
    expect(client.request.mock.calls.map(([method]) => method)).toEqual([
      "canopy.cards.diagnostics.refresh",
      "canopy.cards.list",
    ]);
  });

  it("requires a canonical reload after disconnect before writes", () => {
    const host = {};
    const state = getCanopyState(host);
    state.loaded = true;
    state.cards = [createCanopyCard()];
    resetCanopyConnectionState(host);
    expect(state.loaded).toBe(false);
    expect(state.mutationReadiness).toBe("canonical_reload_required");
    expect(state.cards).toHaveLength(1);
  });

  it.each([
    ["running", "running"],
    ["queued", "queued"],
    ["done", "succeeded"],
    ["failed", "failed"],
  ] as const)("derives %s lifecycle from the native session", (status, expected) => {
    const session = createGatewaySession({ status, hasActiveRun: status === "running" });
    const card = createCanopyCard({ sessionKey: session.key });
    expect(getCanopyLifecycle(card, [session]).state).toBe(expected);
  });
});
