import { describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { createAgentToAgentPolicy } from "./session-visibility.js";

describe("directional agent-to-agent permissions", () => {
  it("defaults open, denies before allows, and does not materialize later agents", () => {
    const open = createAgentToAgentPolicy({ agents: { entries: { a: { agentToAgent: { allow: [], deny: [] } } } } });
    expect(open.isAllowed("a", "b")).toBe(true);
    expect(open.isAllowed("a", "later")).toBe(true);
    const cfg: BranchConfig = { agents: { entries: {
      a: { agentToAgent: { allow: ["*"], deny: ["b"] } },
      b: { agentToAgent: { deny: ["a"] } },
    } } };
    const pair = createAgentToAgentPolicy(cfg);
    expect(pair.isAllowed("a", "b")).toBe(false);
    expect(pair.isAllowed("a", "later")).toBe(true);
    expect(pair.isAllowed("b", "a")).toBe(false);
    expect(createAgentToAgentPolicy({ agents: { entries: { a: { agentToAgent: { allow: [""] } } } } }).isAllowed("a", "b")).toBe(false);
    expect(createAgentToAgentPolicy({ agents: { entries: { a: { agentToAgent: { deny: [""] } } } } }).isAllowed("a", "b")).toBe(false);
    expect(createAgentToAgentPolicy({ tools: { agentToAgent: { enabled: false } } }).isAllowed("a", "b")).toBe(false);
  });

  it("keeps one-way sends distinct from replies and matches A2A peers", () => {
    const policy = createAgentToAgentPolicy({ agents: { entries: {
      a: { agentToAgent: { deny: ["a2a:blocked*"] } },
      b: { agentToAgent: { deny: ["a"] } },
    } } });
    expect(policy.isAllowed("a", "b")).toBe(true);
    expect(policy.isAllowed("b", "a")).toBe(false);
    expect(policy.isAllowed("a", "a2a:blocked-peer")).toBe(false);
    expect(policy.isAllowed("a", "a2a:open-peer")).toBe(true);
  });
});
