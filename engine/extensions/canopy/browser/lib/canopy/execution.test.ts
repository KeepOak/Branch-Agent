// @vitest-environment node
import "../../test/host.setup.ts";
import { describe, expect, it } from "vitest";
import { startCanopyCard, stopCanopyCard } from "./execution.ts";
import { getCanopyState } from "./runtime.ts";
import { createCanopyCard, createCanopyTestClient } from "./test/index-helpers.ts";

describe("Canopy native execution", () => {
  it("starts through the card owner and uses its accepted session", async () => {
    const host = {};
    const card = createCanopyCard();
    const started = {
      ...card,
      status: "running",
      sessionKey: "agent:main:subagent:worker",
      runId: "run-1",
    };
    const state = getCanopyState(host);
    state.loaded = true;
    state.cards = [card];
    const client = createCanopyTestClient({ "canopy.cards.start": { card: started } });
    expect(await startCanopyCard({ host, client, card })).toBe(started.sessionKey);
    expect(client.request.mock.calls.map(([method]) => method)).toEqual(["canopy.cards.start"]);
    expect(state.cards[0]?.runId).toBe("run-1");
  });

  it("aborts the recorded native session run before updating the card", async () => {
    const host = {};
    const card = createCanopyCard({
      status: "running",
      sessionKey: "agent:main:dashboard:worker",
      runId: "run-1",
    });
    const state = getCanopyState(host);
    state.loaded = true;
    state.cards = [card];
    const client = createCanopyTestClient({
      "chat.abort": { aborted: true },
      "canopy.cards.update": { card: { ...card, status: "blocked" } },
    });
    await stopCanopyCard({ host, client, card });
    expect(client.request.mock.calls.map(([method]) => method)).toEqual([
      "chat.abort",
      "canopy.cards.update",
    ]);
    expect(client.request.mock.calls[0]?.[1]).toMatchObject({ runId: "run-1" });
    expect(state.cards[0]?.status).toBe("blocked");
  });

  it("does not claim cancellation when the native owner aborted nothing", async () => {
    const host = {};
    const card = createCanopyCard({
      sessionKey: "agent:main:dashboard:worker",
      runId: "finished-run",
    });
    const state = getCanopyState(host);
    state.loaded = true;
    state.cards = [card];
    const client = createCanopyTestClient({ "chat.abort": { aborted: false } });
    await stopCanopyCard({ host, client, card });
    expect(client.request.mock.calls.map(([method]) => method)).toEqual([
      "chat.abort",
      "chat.abort",
    ]);
    expect(state.cards[0]).toEqual(card);
  });
});
