import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  validateChatSendParams,
  validateContactsOutsideHelloParams,
  validateRoomsSendParams,
} from "../../../packages/gateway-protocol/src/index.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { buildPersistedUserTurnMetadata } from "../../sessions/user-turn-transcript.metadata.js";
import {
  isOutsideAgentOnline,
  listOutsideAgents,
  outsideAgentId,
  outsideAgentMayMessage,
  outsideAgentPeers,
  outsideAgentSender,
  recordOutsideAgent,
} from "./outside-agents.js";
import { projectContacts } from "./project.js";

const dirs: string[] = [];
function scratchEnv(): NodeJS.ProcessEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-outside-agents-"));
  dirs.push(dir);
  return { ...process.env, BRANCH_STATE_DIR: dir };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("outside agents over branch mcp serve", () => {
  it("derives a stable contact id from the MCP client name", () => {
    expect(outsideAgentId("Claude Code")).toBe("claude-code");
    expect(outsideAgentId("codex-mcp-client")).toBe("codex-mcp-client");
    expect(outsideAgentId("  Gemini CLI!! ")).toBe("gemini-cli");
    expect(outsideAgentId("???")).toBe("outside-agent");
  });

  it("remembers each agent once, keeps its first-seen time and refreshes the rest", () => {
    const env = scratchEnv();
    recordOutsideAgent(
      { id: "claude-code", name: "Claude Code", version: "2.1.0", where: "legion" },
      1_000,
      env,
    );
    recordOutsideAgent({ id: "codex", name: "Codex" }, 2_000, env);
    const again = recordOutsideAgent(
      { id: "claude-code", name: "Claude Code", version: "2.2.0", where: "legion" },
      5_000,
      env,
    );
    expect(again).toMatchObject({ firstSeenAt: 1_000, lastSeenAt: 5_000, version: "2.2.0" });
    expect(listOutsideAgents(env).map((row) => row.id)).toEqual(["claude-code", "codex"]);
    expect(isOutsideAgentOnline(again, 5_000 + 60_000)).toBe(true);
    expect(isOutsideAgentOnline(again, 5_000 + 10 * 60_000)).toBe(false);
  });

  it("shows a remembered agent as an outside contact with its name and where it runs", () => {
    const env = scratchEnv();
    const record = recordOutsideAgent(
      { id: "claude-code", name: "Claude Code", version: "2.1.0", where: "legion" },
      1_000,
      env,
    );
    const peers = outsideAgentPeers([record], []);
    const { contacts } = projectContacts({
      agents: [{ id: "main", name: "Sapling" }],
      defaultAgentId: "main",
      sessions: [],
      outsidePeers: peers,
    });
    expect(contacts.find((row) => row.id === "a2a:claude-code")).toMatchObject({
      kind: "outside",
      name: "Claude Code",
      where: "legion",
    });
    // A configured A2A peer with the same name keeps its own entry.
    expect(outsideAgentPeers([record], [{ name: "claude-code", where: "studio:443" }])).toEqual([]);
  });

  it("records the agent, not the owner, as the sender of its messages", () => {
    const metadata = buildPersistedUserTurnMetadata(
      {
        text: "Reply with exactly OK",
        sender: outsideAgentSender({ id: "claude-code", name: "Claude Code" }),
      },
      [],
    );
    expect(metadata).toMatchObject({
      senderId: "claude-code",
      senderName: "Claude Code",
      senderIdentity: {
        type: "observation",
        id: "claude-code",
        pluginId: "a2a",
        senderKind: "bot",
      },
    });
  });

  it("follows the Trunk's Who it knows switch for the agent", () => {
    const open = {} as BranchConfig;
    const closed = {
      agents: { entries: { oak: { agentToAgent: { deny: ["a2a:claude-code"] } } } },
    } as unknown as BranchConfig;
    expect(outsideAgentMayMessage(open, "oak", "claude-code")).toBe(true);
    expect(outsideAgentMayMessage(closed, "oak", "claude-code")).toBe(false);
    expect(outsideAgentMayMessage(closed, "elm", "claude-code")).toBe(true);
    const off = { tools: { agentToAgent: { enabled: false } } } as unknown as BranchConfig;
    expect(outsideAgentMayMessage(off, "oak", "claude-code")).toBe(false);
  });

  it("accepts the outside agent on the wire only in its closed shape", () => {
    const agent = { id: "claude-code", name: "Claude Code", version: "2.1.0", where: "legion" };
    expect(validateContactsOutsideHelloParams({ agent })).toBe(true);
    expect(validateContactsOutsideHelloParams({ agent: { ...agent, id: "Not An Id" } })).toBe(
      false,
    );
    expect(validateContactsOutsideHelloParams({ agent: { ...agent, admin: true } })).toBe(false);
    expect(
      validateChatSendParams({
        sessionKey: "agent:oak:x",
        message: "hi",
        idempotencyKey: "k",
        outsideAgent: agent,
      }),
    ).toBe(true);
    expect(validateRoomsSendParams({ roomId: "r1", message: "hi", outsideAgent: agent })).toBe(
      true,
    );
  });
});
