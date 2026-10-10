import { describe, expect, it, vi } from "vitest";
import type { SignalDecision } from "./signal-wake-decide.js";
import { createSignalWakeGitHub, type RepoRef } from "./signal-wake-github.js";
import { startSignalWakePoller } from "./signal-wake-poller.js";
import { createMemorySignalStateStore } from "./signal-wake-state.js";

const REPO: RepoRef = { owner: "KeepOak", name: "Branch-Agent" };
const HEAD = "a".repeat(40);
const RED = [{ name: "test", status: "completed", conclusion: "failure" }];
const GREEN = [{ name: "test", status: "completed", conclusion: "success" }];

/** One open trunk PR on `HEAD`, with checks that the test switches between green and red. */
function fakeGitHub() {
  const state = { checks: GREEN };
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/check-runs")) {
      return Response.json({ total_count: 0, check_runs: state.checks });
    }
    if (url.includes("/issues/") && url.includes("/comments")) {
      return Response.json([]);
    }
    if (url.includes("/pulls?")) {
      return Response.json([
        { number: 7, user: { login: "stabrea" }, head: { ref: "trunk/builder-1-signal", sha: HEAD } },
      ]);
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { state, fetchImpl };
}

describe("signal wake poller with a throwing observe tap", () => {
  it("still fires ci-red and reports the observe error", async () => {
    const fake = fakeGitHub();
    const notify = vi.fn<(signal: SignalDecision) => void>();
    const errors: string[] = [];
    const observe = vi.fn(() => {
      throw new Error("observer broke");
    });
    const poller = startSignalWakePoller({
      github: createSignalWakeGitHub({ fetchImpl: fake.fetchImpl, token: "t" }),
      repos: [REPO],
      trunkIds: () => ["builder-1"],
      notify,
      observe,
      store: createMemorySignalStateStore(),
      onError: (message) => errors.push(message),
      intervalMs: 1e9,
    });
    await poller.tick();
    fake.state.checks = RED;
    await poller.tick();
    await poller.stop();

    expect(observe).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toMatchObject({ reason: "ci-red", pr: 7 });
    expect(errors).toContain("observer broke");
  });
});
