import { describe, expect, it } from "vitest";
import { applyAgentConfig, pruneAgentConfig } from "../commands/agents.config.js";
import {
  retainLegacyDefaultAgentId,
  resolveSessionStoreCompatibilityAgentId,
  tryGetLegacyDefaultAgentId,
} from "../config/legacy.default-agent-owner.js";
import type { BranchConfig } from "../config/types.js";
import { validateConfigObject } from "../config/validation-core.js";
import { AgentsSchema } from "../config/zod-schema.agents.js";
import { resolveGatewayAgentSelectionState } from "../gateway/agent-list.js";
import { resolveAgentRoute } from "../routing/resolve-route.js";
import {
  tryResolveAmbientOwnerAgentId,
  tryResolveLegacyCompatibilityAgentId,
  tryResolveLegacyDataOwnerAgentId,
} from "./agent-scope-config.js";
import { resolveSubagentRequesterAgentId } from "./subagent-requester-owner.js";

describe("contact Trunk routing", () => {
  const cfg: BranchConfig = {
    agents: { ownership: "explicit", defaultId: "fern", entries: { oak: {}, fern: {} } },
  };
  it("persists the first created Trunk as default and preserves it when another is created", () => {
    const first = applyAgentConfig({ agents: { entries: {} } }, { agentId: "oak" });
    expect(first.agents?.defaultId).toBe("oak");
    expect(applyAgentConfig(first, { agentId: "fern" }).agents?.defaultId).toBe("oak");
  });
  it("accepts an explicit contact default but rejects missing Trunks", () => {
    expect(AgentsSchema.safeParse(cfg.agents).success).toBe(true);
    expect(
      AgentsSchema.safeParse({ defaultId: "fern", entries: { oak: {}, fern: {} } }).success,
    ).toBe(true);
    expect(AgentsSchema.safeParse({ ...cfg.agents, defaultId: "gone" }).success).toBe(false);
    const validated = validateConfigObject(cfg);
    expect(validated.ok).toBe(true);
    if (validated.ok) expect(validated.config.agents?.defaultId).toBe("fern");
  });
  it("preserves the bootstrap inference owner when creating and selecting a contact", () => {
    const bootstrap: BranchConfig = {
      agents: { entries: { bootstrap: { model: "ollama/local" } }, defaults: { model: "ollama/local" } },
    };
    const created = applyAgentConfig(bootstrap, { agentId: "fern", name: "Fern" });
    const selected: BranchConfig = { ...created, agents: { ...created.agents, defaultId: "fern" } };
    expect(selected.agents?.defaults?.systemAgent?.agentId).toBe("bootstrap");
    expect(selected.agents?.entries?.bootstrap?.model).toBe("ollama/local");
    expect(selected.agents?.defaults?.model).toBe("ollama/local");
    expect(tryResolveAmbientOwnerAgentId(selected)).toBe("bootstrap");
    expect(resolveAgentRoute({ cfg: selected, channel: "telegram" }).agentId).toBe("fern");
    expect(AgentsSchema.safeParse({ entries: {} }).success).toBe(false);
  });
  it("projects the chosen contact and routes direct messages from different channels to its ongoing conversation", () => {
    expect(resolveGatewayAgentSelectionState(cfg)).toMatchObject({
      defaultId: "fern",
      selectionRequired: false,
    });
    for (const channel of ["webchat", "telegram", "signal"]) {
      expect(
        resolveAgentRoute({ cfg, channel, peer: { kind: "direct", id: "owner" } }),
      ).toMatchObject({ agentId: "fern", sessionKey: "agent:fern:main", matchedBy: "default" });
    }
  });
  it("changes routing with the selected default without rewriting previous conversation keys", () => {
    const old = resolveAgentRoute({
      cfg,
      channel: "telegram",
      peer: { kind: "direct", id: "owner" },
    });
    const next = resolveAgentRoute({
      cfg: { agents: { ...cfg.agents, defaultId: "oak" } },
      channel: "telegram",
      peer: { kind: "direct", id: "owner" },
    });
    expect(old.sessionKey).toBe("agent:fern:main");
    expect(next.sessionKey).toBe("agent:oak:main");
  });
  it("keeps explicit bindings and their isolation overrides ahead of the default", () => {
    const bound: BranchConfig = {
      ...cfg,
      bindings: [
        {
          agentId: "oak",
          match: { channel: "telegram", peer: { kind: "direct", id: "work" } },
          session: { dmScope: "per-channel-peer" },
        },
      ],
    };
    const route = resolveAgentRoute({
      cfg: bound,
      channel: "telegram",
      peer: { kind: "direct", id: "work" },
    });
    expect(route).toMatchObject({ agentId: "oak", matchedBy: "binding.peer" });
    expect(route.sessionKey).not.toBe("agent:oak:main");
    expect(
      resolveAgentRoute({ cfg: bound, channel: "telegram", peer: { kind: "direct", id: "owner" } })
        .agentId,
    ).toBe("fern");
  });
  it("keeps group conversations isolated from the owner contact", () => {
    const one = resolveAgentRoute({ cfg, channel: "telegram", peer: { kind: "group", id: "one" } });
    const two = resolveAgentRoute({ cfg, channel: "telegram", peer: { kind: "group", id: "two" } });
    expect(one.agentId).toBe("fern");
    expect(one.sessionKey).not.toBe("agent:fern:main");
    expect(one.sessionKey).not.toBe(two.sessionKey);
  });
  it("does not move the separately configured ambient system owner", () => {
    const systemCfg: BranchConfig = {
      agents: { ...cfg.agents, defaults: { systemAgent: { agentId: "oak" } } },
    };
    expect(tryResolveAmbientOwnerAgentId(systemCfg)).toBe("oak");
    expect(tryResolveLegacyCompatibilityAgentId(systemCfg)).toBe("oak");
    expect(resolveSubagentRequesterAgentId(systemCfg, { requesterSessionKey: "main" })).toBe("oak");
    expect(resolveAgentRoute({ cfg: systemCfg, channel: "telegram" }).agentId).toBe("fern");
  });
  it("does not turn a contact into an ambient fallback owner or reattribute retained legacy data", () => {
    expect(tryResolveAmbientOwnerAgentId(cfg)).toBeUndefined();
    expect(tryResolveLegacyCompatibilityAgentId(cfg)).toBeUndefined();
    expect(resolveSubagentRequesterAgentId(cfg, { requesterSessionKey: "main" })).toBeUndefined();
    // Upstream 2026.9.8: retained ownership is Doctor migration provenance, never runtime ownership,
    // so neither the contact nor a switched contact default takes over legacy data.
    const retained = retainLegacyDefaultAgentId(cfg, "oak");
    expect(tryGetLegacyDefaultAgentId(retained)).toBe("oak");
    expect(tryResolveLegacyDataOwnerAgentId(retained)).toBeUndefined();
    expect(resolveSessionStoreCompatibilityAgentId(retained)).toBe("main");
    const switched = retainLegacyDefaultAgentId(
      { agents: { ...cfg.agents, defaultId: "oak" } },
      "oak",
    );
    expect(tryResolveLegacyDataOwnerAgentId(switched)).toBeUndefined();
    expect(resolveSessionStoreCompatibilityAgentId(switched)).toBe("main");
    // Committed migration state is what routes legacy sessions.
    const committed: BranchConfig = {
      agents: { ...cfg.agents, defaults: { sessionStore: { agentId: "oak" } } },
    };
    expect(resolveSessionStoreCompatibilityAgentId(committed)).toBe("oak");
  });
  it("reassigns a removed default to a surviving Trunk", () => {
    const next = pruneAgentConfig(cfg, "fern").config;
    expect(next.agents?.defaultId).toBe("oak");
    expect(AgentsSchema.safeParse(next.agents).success).toBe(true);
  });
});
