import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BranchConfig } from "../config/config.js";
import { replaceSessionEntry } from "../config/sessions/session-accessor.js";
import type { SessionEntry } from "../config/sessions/types.js";
import { createWarnLogCapture } from "../logging/test-helpers/warn-log-capture.js";
import { resolveAgentConfig } from "./agent-scope.js";
import {
  resolveConfiguredToolPolicies,
  resolveEffectiveToolPolicy,
  resolveGroupToolPolicy,
  resolveGroupToolPolicyOutcome,
  resolveInheritedToolPolicyForSession,
  resolveSubagentToolPolicyForSession,
} from "./agent-tools.policy.js";
import { isToolAllowedByPolicyName } from "./tool-policy-match.js";
import { listToolsetIds } from "./tool-toolsets.js";
import { listCoreToolFactoryDescriptors } from "./core-tool-factory-descriptors.js";
import { listCoreToolSections } from "./tool-catalog.js";
import { applyToolPolicyPipeline, buildDefaultToolPolicyPipelineSteps } from "./tool-policy-pipeline.js";
import { resolveToolProfilePolicy } from "./tool-policy.js";
import { resolveToolsetOffers } from "./tool-toolsets-offer.js";

vi.mock("../channels/plugins/session-conversation.js", () => ({
  resolveSessionConversation: ({ rawId }: { rawId: string }) => ({
    id: rawId,
    threadId: undefined,
    baseConversationId: rawId,
    parentConversationCandidates: [],
  }),
}));
vi.mock("../channels/plugins/index.js", () => ({
  getLoadedChannelPlugin: () => ({
    config: {
      listAccountIds: (config: BranchConfig) => [
        "default",
        ...Object.keys(config.channels?.whatsapp?.accounts ?? {}),
      ],
    },
  }),
}));

async function storedSession(
  entry: Partial<SessionEntry>,
  config: BranchConfig = {},
  sessionKey = "agent:main:subagent:limited",
) {
  const store = path.join(
    os.tmpdir(),
    `branch-policy-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    "agents/main/sessions/sessions.json",
  );
  await replaceSessionEntry(
    { sessionKey, storePath: store },
    { sessionId: "limited", updatedAt: Date.now(), ...entry },
  );
  return { config: { ...config, session: { store } }, sessionKey };
}

describe("resolveGroupToolPolicy group context validation", () => {
  const config: BranchConfig = {
    channels: {
      whatsapp: {
        groups: {
          "safe-room": { tools: { allow: ["read"] } },
          "trusted-group": { tools: { allow: ["exec", "read", "write", "edit"] } },
          room: { tools: { allow: ["exec", "read"] } },
          "room:sender:alice": { tools: { allow: ["read"] } },
        },
      },
    },
    tools: { allow: ["read"] },
  };
  function groupPolicy(params: Omit<Parameters<typeof resolveGroupToolPolicy>[0], "config">) {
    return resolveGroupToolPolicy({ config, messageProvider: "whatsapp", ...params });
  }

  it("rejects forged groupId when the session has no group context", () => {
    expect(
      groupPolicy({ sessionKey: "agent:main:main", groupId: "trusted-group" }),
    ).toBeUndefined();
  });

  it("uses session-derived group policy when caller groupId disagrees", () => {
    expect(
      groupPolicy({
        sessionKey: "agent:main:whatsapp:group:safe-room",
        groupId: "trusted-group",
      }),
    ).toEqual({ allow: ["read"] });
  });

  it("accepts caller groupId when spawnedBy provides the trusted group context", () => {
    expect(
      groupPolicy({
        sessionKey: "agent:main:main",
        spawnedBy: "agent:main:whatsapp:group:trusted-group",
        groupId: "trusted-group",
      }),
    ).toEqual({ allow: ["exec", "read", "write", "edit"] });
  });

  it("keeps specific session group policy ahead of trusted parent caller groupId", () => {
    expect(
      groupPolicy({
        sessionKey: "agent:main:whatsapp:group:room:sender:alice",
        groupId: "room",
      }),
    ).toEqual({ allow: ["read"] });
  });

  it("prefers the session-derived channel over caller-supplied messageProvider", () => {
    const channelCfg = {
      channels: {
        discord: { groups: { C123: { tools: { allow: ["exec"] } } } },
        slack: { groups: { C123: { tools: { allow: ["read"] } } } },
      },
    } as unknown as BranchConfig;
    expect(
      resolveGroupToolPolicy({
        config: channelCfg,
        sessionKey: "agent:main:slack:group:C123",
        messageProvider: "discord",
        groupId: "C123",
      }),
    ).toEqual({ allow: ["read"] });
  });

  it.each(["agent:main:whatsapp:group:safe-room", "agent:main:main"])(
    "reports unavailable scheduled authority for %s before tool construction",
    (sessionKey) => {
      const params = { config, sessionKey, accountId: "removed", requireConfiguredAccount: true };
      expect(resolveGroupToolPolicyOutcome(params)).toMatchObject({
        kind: "account-unavailable",
        accountId: "removed",
        message: expect.stringContaining('Scheduled account "removed" is unavailable'),
      });
      expect(() => resolveGroupToolPolicy(params)).toThrow(
        'Scheduled account "removed" is unavailable',
      );
    },
  );

  it("preserves intentional deny-all policy for a configured scheduled account", () => {
    expect(
      resolveGroupToolPolicyOutcome({
        config: {
          channels: {
            whatsapp: {
              accounts: { work: {} },
              groups: { "safe-room": { tools: { deny: ["*"] } } },
            },
          },
        },
        sessionKey: "agent:main:whatsapp:group:safe-room",
        accountId: "work",
        requireConfiguredAccount: true,
      }),
    ).toMatchObject({ kind: "resolved", policy: { deny: ["*"] } });
  });
});

describe("stored subagent tool policies", () => {
  it("recomputes a persisted leaf as an orchestrator under the recursive default", async () => {
    const { config, sessionKey } = await storedSession({
      spawnDepth: 1,
      subagentRole: "leaf",
      subagentControlScope: "none",
    });
    const policy = resolveSubagentToolPolicyForSession(config, sessionKey);
    expect(isToolAllowedByPolicyName("sessions_spawn", policy)).toBe(true);
    expect(isToolAllowedByPolicyName("subagents", policy)).toBe(true);
  });

  it("keeps flat depth-1 sessions as leaves under an explicit finite cap", async () => {
    const { config, sessionKey } = await storedSession(
      { spawnDepth: 1, subagentRole: "leaf", subagentControlScope: "none" },
      { agents: { defaults: { subagents: { maxSpawnDepth: 1 } } } },
    );
    const policy = resolveSubagentToolPolicyForSession(config, sessionKey);
    expect(isToolAllowedByPolicyName("gateway", policy)).toBe(false);
    for (const tool of ["sessions_spawn", "subagents", "sessions_search"]) {
      expect(isToolAllowedByPolicyName(tool, policy), tool).toBe(false);
    }
    for (const tool of ["memory_search", "memory_get"]) {
      expect(isToolAllowedByPolicyName(tool, policy), tool).toBe(true);
    }
  });

  it("does not let configured allow entries re-enable hard-denied tools", async () => {
    const denied = [
      "gateway",
      "agents_list",
      "branch",
      "session_status",
      "progress_card",
      "automations",
      "cron",
      "message",
      "sessions_send",
      "conversations_list",
      "conversations_send",
      "conversations_turn",
    ];
    const { config, sessionKey } = await storedSession(
      { spawnDepth: 1, subagentRole: "orchestrator", subagentControlScope: "children" },
      { tools: { subagents: { tools: { allow: [...denied, "memory_search"] } } } },
    );
    const policy = resolveSubagentToolPolicyForSession(config, sessionKey);
    for (const tool of denied) {
      expect(isToolAllowedByPolicyName(tool, policy), tool).toBe(false);
    }
    expect(isToolAllowedByPolicyName("memory_search", policy)).toBe(true);
  });

  it("applies inherited tool policy from stored ACP sessions without subagent metadata", async () => {
    const { config, sessionKey } = await storedSession(
      { inheritedToolAllow: ["custom_plugin_tool"], inheritedToolDeny: ["custom_denied_tool"] },
      {},
      "agent:main:acp:limited",
    );
    const policy = resolveInheritedToolPolicyForSession(config, sessionKey);
    expect(isToolAllowedByPolicyName("custom_plugin_tool", policy)).toBe(true);
    expect(isToolAllowedByPolicyName("custom_denied_tool", policy)).toBe(false);
    expect(isToolAllowedByPolicyName("read", policy)).toBe(false);
  });
});

describe("resolveEffectiveToolPolicy", () => {
  it("applies implicit-main defaults tool restrictions to a pre-roster config", () => {
    const config = {
      agents: { defaults: { tools: { deny: ["exec"] } } },
    } as unknown as BranchConfig;
    expect(resolveEffectiveToolPolicy({ config })).toMatchObject({
      agentId: "main",
      agentPolicy: { deny: ["exec"] },
    });
  });

  it("does not implicitly re-expose tools from configured sections (#47487)", () => {
    const config: BranchConfig = {
      tools: { profile: "messaging", exec: { host: "sandbox" }, fs: { workspaceOnly: false } },
    };
    expect(resolveEffectiveToolPolicy({ config }).profileAlsoAllow).toBeUndefined();
  });

  it("does not warn an agent profile about inherited global tool sections (#47487)", async () => {
    const logs = createWarnLogCapture("branch-agent-tools-policy-test");
    try {
      const config: BranchConfig = {
        tools: { exec: { mode: "allowlist" }, fs: { workspaceOnly: true } },
        agents: {
          entries: { sage: { tools: { profile: "messaging", alsoAllow: ["view_image"] } } },
        },
      };
      expect(resolveEffectiveToolPolicy({ config, agentId: "sage" }).profileAlsoAllow).toEqual([
        "view_image",
      ]);
      expect(await logs.findText('tools policy: profile "messaging"')).toBeUndefined();
    } finally {
      logs.cleanup();
    }
  });

  it.each<{ name: string; tools: BranchConfig["tools"]; warning?: string }>([
    { name: "provider wildcard deny", tools: { byProvider: { fixture: { deny: ["pro*"] } } } },
    { name: "provider profile", tools: { byProvider: { fixture: { profile: "minimal" } } } },
    {
      name: "provider profile alsoAllow",
      tools: { byProvider: { fixture: { profile: "minimal", alsoAllow: ["process"] } } },
      warning: 'Add alsoAllow: ["process"]',
    },
  ])("warns only about actionable grants with $name", async ({ tools, warning }) => {
    const logs = createWarnLogCapture("branch-agent-tools-policy-test");
    try {
      const result = resolveEffectiveToolPolicy({
        config: {
          tools,
          agents: {
            entries: {
              ops: {
                tools: { profile: "messaging", alsoAllow: ["exec"], exec: { host: "gateway" } },
              },
            },
          },
        },
        agentId: "ops",
        modelProvider: "fixture",
      });
      const logged = await logs.findText('tools policy: profile "messaging"');
      if (warning) {
        expect(logged).toContain(warning);
      } else {
        expect(logged).toBeUndefined();
      }
      expect(result.profileAlsoAllow).toEqual(["exec"]);
    } finally {
      logs.cleanup();
    }
  });
});

describe("resolveEffectiveToolPolicy with agent toolsets", () => {
  const rosterWith = (entry: Record<string, unknown>) =>
    ({ agents: { entries: { ops: entry } } }) as unknown as BranchConfig;
  const allOn = Object.fromEntries(listToolsetIds().map((id) => [id, true]));

  it("adds denies for switched-off toolsets and never adds an allow", () => {
    const config = rosterWith({ toolsets: { browser: false, messaging: false } });
    const { agentPolicy } = resolveEffectiveToolPolicy({ config, agentId: "ops" });
    expect(agentPolicy?.deny).toEqual(expect.arrayContaining(["browser", "conversations_send"]));
    expect(agentPolicy?.allow).toBeUndefined();
  });

  it("produces the same agent policy when every toolset is on or unset", () => {
    const tools = { deny: ["exec"] };
    const unset = resolveEffectiveToolPolicy({
      config: rosterWith({ tools }),
      agentId: "ops",
    }).agentPolicy;
    const everyOn = resolveEffectiveToolPolicy({
      config: rosterWith({ tools, toolsets: allOn }),
      agentId: "ops",
    }).agentPolicy;
    expect(everyOn).toEqual(unset);
  });

  it("keeps the agent's own deny in force when toolsets are on", () => {
    const config = rosterWith({ tools: { deny: ["exec"] }, toolsets: allOn });
    const { agentPolicy } = resolveEffectiveToolPolicy({ config, agentId: "ops" });
    expect(isToolAllowedByPolicyName("exec", agentPolicy)).toBe(false);
    expect(isToolAllowedByPolicyName("read", agentPolicy)).toBe(true);
  });
});

describe("agent toolsets through the tool policy pipeline", () => {
  const rosterWith = (entry: Record<string, unknown>) =>
    ({ agents: { entries: { ops: entry } } }) as unknown as BranchConfig;
  // The same steps the gateway applies to the registered tools (src/gateway/tool-resolution.ts).
  const builtInToolNames = [
    ...new Set([
      ...listCoreToolSections({ swarmEnabled: true, personalInstructionsEnabled: true }).flatMap((section) =>
        section.tools.map((tool) => tool.id),
      ),
      ...listCoreToolFactoryDescriptors().map((descriptor) => descriptor.name),
    ]),
  ];
  const offeredThroughPipeline = (config: BranchConfig): string[] => {
    const effective = resolveEffectiveToolPolicy({ config, agentId: "ops" });
    const steps = buildDefaultToolPolicyPipelineSteps({
      profilePolicy: resolveToolProfilePolicy(effective.profile),
      profile: effective.profile,
      globalPolicy: effective.globalPolicy,
      agentPolicy: effective.agentPolicy,
      agentId: "ops",
    });
    return applyToolPolicyPipeline({
      tools: builtInToolNames.map((name) => ({ name })),
      toolMeta: () => undefined,
      warn: () => {},
      steps,
    }).map((tool) => tool.name);
  };

  it("removes exec, process, terminal and code_execution when the shell toolset is off", () => {
    const offered = offeredThroughPipeline(
      rosterWith({ toolsets: { shell: false } }),
    );
    for (const name of ["exec", "process", "terminal", "code_execution"]) {
      expect(offered, name).not.toContain(name);
    }
    expect(offered).toContain("read");
    expect(offered).toContain("message");
  });

  it("removes the browser for a legacy deny on the agent's tools", () => {
    const offered = offeredThroughPipeline(rosterWith({ tools: { deny: ["browser"] } }));
    expect(offered).not.toContain("browser");
    expect(offered).toContain("read");
  });

  it("a legacy browser deny wins over the browser switch being on, and the offer says so", () => {
    const config = rosterWith({ toolsets: { browser: true }, tools: { deny: ["browser"] } });
    expect(offeredThroughPipeline(config)).not.toContain("browser");
    const effective = resolveEffectiveToolPolicy({ config, agentId: "ops" });
    const policies = resolveConfiguredToolPolicies({
      cfg: config,
      agentTools: resolveAgentConfig(config, "ops")?.tools,
    });
    expect(effective.agentPolicy?.deny).toContain("browser");
    expect(resolveToolsetOffers(policies).browser).toBe(false);
  });

  it("keeps every built-in tool when no toolset is off and no deny is set", () => {
    const offered = offeredThroughPipeline(rosterWith({}));
    expect(offered.toSorted()).toEqual([...builtInToolNames].toSorted());
  });
});
