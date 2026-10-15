import { expect, it } from "vitest";
import {
  describePreparedModelRuntimeOwnerStates,
  formatPreparedModelFailure,
} from "./prepared-model-runtime.trace.js";
import type { PreparedModelRuntimeOwner } from "./prepared-model-runtime.types.js";

function owner(agentId: string, state: Partial<PreparedModelRuntimeOwner>): PreparedModelRuntimeOwner {
  return { input: { agentId }, needsRefresh: false, ...state } as unknown as PreparedModelRuntimeOwner;
}

it("describes each owner as published, failed, stale or pending", () => {
  const owners = new Map<string, PreparedModelRuntimeOwner>([
    ["tk", owner("tk", { snapshot: {} as never })],
    ["oak", owner("builder-oak", { refreshError: new Error("model preparation has not published") })],
    ["elm", owner("builder-elm", { needsRefresh: true })],
    ["birch", owner("builder-birch", {})],
  ]);
  expect(describePreparedModelRuntimeOwnerStates(owners)).toBe(
    "tk=published builder-oak=failed(model preparation has not published) builder-elm=stale builder-birch=pending",
  );
});

it("limits the description to the requested publication scope", () => {
  const owners = new Map<string, PreparedModelRuntimeOwner>([
    ["tk", owner("tk", { snapshot: {} as never })],
    ["oak", owner("builder-oak", { refreshError: new Error("boom") })],
  ]);
  expect(describePreparedModelRuntimeOwnerStates(owners, new Set(["builder-oak"]))).toBe(
    "builder-oak=failed(boom)",
  );
});

it("reports none for an empty publication scope", () => {
  expect(describePreparedModelRuntimeOwnerStates(new Map(), undefined)).toBe("none");
});

it("truncates a long failure message so one owner cannot flood the trace line", () => {
  const owners = new Map<string, PreparedModelRuntimeOwner>([
    ["oak", owner("builder-oak", { refreshError: new Error("x".repeat(500)) })],
  ]);
  const text = describePreparedModelRuntimeOwnerStates(owners);
  expect(text).toBe(`builder-oak=failed(${"x".repeat(120)})`);
});

const FAKE_ANTHROPIC_KEY = "sk-ant-api03-FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0123456789";
const FAKE_GITHUB_TOKEN = "ghp_FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE0123";

it("never puts an API key from a failure message into the owner-state trace", () => {
  const owners = new Map<string, PreparedModelRuntimeOwner>([
    [
      "oak",
      owner("builder-oak", {
        refreshError: new Error(`upstream rejected key ${FAKE_ANTHROPIC_KEY} for this agent`),
      }),
    ],
  ]);
  const text = describePreparedModelRuntimeOwnerStates(owners);
  expect(text).toContain("builder-oak=failed(");
  expect(text).not.toContain("FAKEFAKEFAKE");
});

it("redacts a token-shaped secret before truncating the logged failure reason", () => {
  const text = formatPreparedModelFailure(`rejected ${FAKE_GITHUB_TOKEN} during refresh`, 160);
  expect(text).not.toContain("FAKEFAKEFAKE");
  expect(text.startsWith("rejected ")).toBe(true);
});
