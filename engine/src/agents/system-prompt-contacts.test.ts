import { splitSystemPromptCacheBoundary } from "@branch/ai/internal/shared";
import { describe, expect, it } from "vitest";
import type { BranchConfig } from "../config/types.branch.js";
import { buildConfiguredAgentSystemPrompt } from "./system-prompt-config.js";

const config: BranchConfig = {
  agents: {
    entries: {
      oak: { name: "Oak", agentToAgent: { deny: ["secret"] } },
      ledger: { name: "Ledger", description: "Money & receipts" },
      secret: { name: "Private Trunk" },
    },
  },
};

function prompt(
  overrides: Parameters<typeof buildConfiguredAgentSystemPrompt>[0] = { workspaceDir: "/tmp/oak" },
) {
  return buildConfiguredAgentSystemPrompt({
    workspaceDir: "/tmp/oak",
    config,
    agentId: "oak",
    runtimeInfo: { agentId: "oak", sessionKey: "agent:oak:main" },
    toolNames: ["sessions_send"],
    ...overrides,
  });
}

describe("Your contacts prompt", () => {
  it("lists only reachable named Trunks with canonical routes in a byte-stable prefix", () => {
    const first = prompt();
    const second = prompt();
    const prefix = splitSystemPromptCacheBoundary(first)?.stablePrefix;
    expect(first).toBe(second);
    expect(prefix).toContain("## Your contacts");
    expect(prefix).toContain("You are Oak.");
    expect(prefix).toContain(
      "Ledger: Money & receipts. Message: sessions_send to agent:ledger:main",
    );
    expect(prefix).not.toContain("Private Trunk");
    expect(prefix).not.toContain("agent:secret:main");
    expect(prefix).not.toContain("You are oak.");
    expect(prompt({ workspaceDir: "/tmp/oak", toolNames: [] })).not.toContain("agent:ledger:main");
  });

  it("uses the configured canonical main key without storing a session id", () => {
    const changed = prompt({
      workspaceDir: "/tmp/oak",
      config: { ...config, session: { mainKey: "home" } },
    });
    expect(changed).toContain("sessions_send to agent:ledger:home");
    expect(changed).not.toContain("sessions_send to agent:ledger:main");
  });

  it("lists only configured, reachable A2A peers when the message tool is available", () => {
    const withPeers: BranchConfig = {
      ...config,
      channels: {
        a2a: {
          peers: {
            hermes: { token: "inbound-secret", url: "https://studio.local/a2a" },
            waiting: { token: "inbound-secret" },
          },
        },
      },
    };
    const rendered = prompt({
      workspaceDir: "/tmp/oak",
      config: withPeers,
      toolNames: ["message"],
    });
    const section = rendered.split("## Your contacts\n")[1]?.split("## Workspace Files")[0];
    expect(section).toContain("Hermes on studio.local (A2A): message tool, channel a2a, to hermes");
    expect(section).not.toContain("waiting");
    expect(section).not.toContain("inbound-secret");
    const denied = prompt({
      workspaceDir: "/tmp/oak",
      config: {
        ...withPeers,
        agents: {
          entries: {
            ...config.agents?.entries,
            oak: { name: "Oak", agentToAgent: { deny: ["a2a:hermes"] } },
          },
        },
      },
      toolNames: ["message"],
    });
    expect(denied.split("## Your contacts\n")[1]?.split("## Workspace Files")[0]).not.toContain(
      "Hermes on studio.local",
    );
  });

  it("uses room member names, and omits the section in groups containing people", () => {
    const room = {
      title: "Studio",
      members: [
        { id: "oak", name: "Oak" },
        { id: "ledger", name: "Ledger" },
      ],
    };
    const roomPrompt = prompt({ workspaceDir: "/tmp/oak", contactsRoom: room });
    expect(splitSystemPromptCacheBoundary(roomPrompt)?.stablePrefix).toContain(
      "Other Trunks in this room:\n- Ledger",
    );
    expect(roomPrompt).not.toContain("sessions_send to agent:ledger:main");
    expect(roomPrompt).not.toContain("id=ledger");
    expect(
      prompt({ workspaceDir: "/tmp/oak", contactsRoom: { ...room, hasPeople: true } }),
    ).not.toContain("## Your contacts");
    expect(
      prompt({ workspaceDir: "/tmp/oak", runtimeInfo: { agentId: "oak", chatType: "group" } }),
    ).not.toContain("## Your contacts");
  });
});
