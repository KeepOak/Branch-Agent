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
  assignOutsideAgentId,
  isOutsideAgentOnline,
  listOutsideAgents,
  outsideAgentId,
  outsideAgentMayMessage,
  outsideAgentPeers,
  outsideAgentRefusal,
  outsideAgentSender,
  readOutsideAgentSettings,
  recordOutsideAgent,
  updateOutsideAgentSettings,
} from "./outside-agents.js";
import { projectContacts } from "./project.js";

const dirs: string[] = [];
function scratchEnv(): NodeJS.ProcessEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-outside-agents-"));
  dirs.push(dir);
  return { ...process.env, BRANCH_STATE_DIR: dir };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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

  it("groups a joined computer's Trunks under one Recent contact and preserves their characters", () => {
    const env = scratchEnv();
    const branch = recordOutsideAgent({ id: "branch-nas", name: "NAS-linux", kind: "branch" }, 1_000, env);
    const tester = recordOutsideAgent({ id: "branch-nas--tester", name: "Tester", kind: "trunk", via: branch.id, avatar: "branch:ember" }, 1_000, env);
    const peers = outsideAgentPeers([branch, tester], []);
    expect(peers.find((row) => row.name === tester.id)).toMatchObject({ kind: "trunk", via: branch.id, avatar: "branch:ember" });
    const { contacts } = projectContacts({ agents: [{ id: "main", name: "Sapling" }], defaultAgentId: "main", sessions: [], outsidePeers: peers });
    expect(contacts.filter((row) => row.kind === "outside").map((row) => row.name)).toEqual(["NAS-linux"]);
    expect(contacts.find((row) => row.id === "a2a:branch-nas")?.face?.trunks).toEqual([{ name: "Tester", avatar: "branch:ember" }]);
    expect(validateContactsOutsideHelloParams({ agent: { id: tester.id, name: tester.name, kind: "trunk", via: branch.id, avatar: "branch:ember" } })).toBe(true);
    expect(recordOutsideAgent({ id: tester.id, name: tester.name, kind: "trunk", via: branch.id }, 2_000, env)).toMatchObject({ avatar: "branch:ember" });
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

  it("Connected agents: refusals point to the plain settings name", () => {
    const env = scratchEnv();
    const claude = { id: "claude-code-a1b2c3", name: "Claude Code" };
    expect(readOutsideAgentSettings(env)).toEqual({
      enabled: true,
      revoked: [],
      mayDriveWindow: [],
    });
    expect(outsideAgentRefusal(claude, readOutsideAgentSettings(env))).toBeUndefined();
    updateOutsideAgentSettings({ id: claude.id, revoked: true }, env);
    expect(outsideAgentRefusal(claude, readOutsideAgentSettings(env))).toMatch(
      /Claude Code was disconnected in Settings › Connected agents/,
    );
    expect(
      outsideAgentRefusal({ id: "hermes-1", name: "Hermes" }, readOutsideAgentSettings(env)),
    ).toBeUndefined();
    updateOutsideAgentSettings({ id: claude.id, revoked: false, mayDriveWindow: true }, env);
    updateOutsideAgentSettings({ enabled: false }, env);
    const off = readOutsideAgentSettings(env);
    expect(off).toEqual({ enabled: false, revoked: [], mayDriveWindow: [claude.id] });
    expect(outsideAgentRefusal({ id: "hermes-1", name: "Hermes" }, off)).toMatch(
      /Other agents are off in Settings › Connected agents/,
    );
  });

  it("keeps each agent's project and last activity", () => {
    const env = scratchEnv();
    recordOutsideAgent(
      {
        id: "claude-code-a1b2c3",
        name: "Claude Code",
        project: "EDILAS",
        activity: "Messaging oak",
      },
      1_000,
      env,
    );
    const later = recordOutsideAgent(
      { id: "claude-code-a1b2c3", name: "Claude Code", project: "EDILAS" },
      9_000,
      env,
    );
    expect(later).toMatchObject({
      project: "EDILAS",
      activity: "Messaging oak",
      activityAt: 1_000,
      lastSeenAt: 9_000,
    });
  });

  it("gives a second session with the same name, computer and folder its own id while the first is online", () => {
    const now = 100_000;
    const first = {
      id: "claude-code-a1b2c3",
      name: "Claude Code",
      firstSeenAt: 0,
      lastSeenAt: now - 1_000,
      instance: "p1",
    };
    expect(assignOutsideAgentId({ id: first.id, instance: "p1" }, [first], now)).toBe(first.id);
    expect(assignOutsideAgentId({ id: first.id, instance: "p2" }, [first], now)).toBe(
      `${first.id}-2`,
    );
    const second = { ...first, id: `${first.id}-2`, instance: "p2" };
    expect(assignOutsideAgentId({ id: first.id, instance: "p3" }, [first, second], now)).toBe(
      `${first.id}-3`,
    );
    expect(assignOutsideAgentId({ id: first.id, instance: "p2" }, [first, second], now)).toBe(
      `${first.id}-2`,
    );
    // Once the first has gone quiet, a new session takes the stable id back.
    expect(assignOutsideAgentId({ id: first.id, instance: "p4" }, [first], now + 10 * 60_000)).toBe(
      first.id,
    );
  });
});
