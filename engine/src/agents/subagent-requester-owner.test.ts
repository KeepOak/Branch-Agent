import { describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { resolveSubagentRequesterAgentId } from "./subagent-requester-owner.js";

describe("resolveSubagentRequesterAgentId", () => {
  it("attributes a legacy bare requester row only to the persisted fixed-store owner", () => {
    const cfg = {
      session: { store: "/stores/shared.sqlite" },
      agents: {
        ownership: "explicit",
        defaults: { sessionStore: { agentId: "ops" } },
        entries: { ops: {}, research: {} },
      },
    } satisfies BranchConfig;

    expect(resolveSubagentRequesterAgentId(cfg, { requesterSessionKey: "global" })).toBe("ops");
    expect(
      resolveSubagentRequesterAgentId(cfg, {
        requesterSessionKey: "global",
        requesterAgentId: "research",
      }),
    ).toBe("research");
  });
});
