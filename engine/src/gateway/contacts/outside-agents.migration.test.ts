import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { BranchConfig } from "../../config/types.branch.js";
import {
  legacyOutsideId,
  listOutsideAgents,
  outsideAgentMayDriveWindow,
  outsideAgentMayMessage,
  outsideAgentRefusal,
  readOutsideAgentSettings,
  recordOutsideAgent,
  updateOutsideAgentSettings,
} from "./outside-agents.js";

const dirs: string[] = [];
function scratchEnv(): NodeJS.ProcessEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-outside-migration-"));
  dirs.push(dir);
  return { ...process.env, BRANCH_STATE_DIR: dir };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** What #220/#221 left behind: one product-wide row and rules written for `a2a:claude-code`. */
function legacyState(env: NodeJS.ProcessEnv) {
  const file = path.join(env.BRANCH_STATE_DIR!, "contacts", "outside-agents.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify([
      {
        id: "claude-code",
        name: "Claude Code",
        where: "LEGION",
        firstSeenAt: 500,
        lastSeenAt: 900,
      },
    ]),
  );
  updateOutsideAgentSettings({ id: "claude-code", mayDriveWindow: true }, env);
}

describe("outside agents from before per-session ids", () => {
  it("knows the product-wide id behind a session id", () => {
    expect(legacyOutsideId("claude-code-a1b2c3")).toBe("claude-code");
    expect(legacyOutsideId("claude-code-a1b2c3-2")).toBe("claude-code");
    expect(legacyOutsideId("claude-code")).toBeUndefined();
    expect(legacyOutsideId("codex-mcp-client")).toBeUndefined();
  });

  it("folds the old contact row into the first session, keeping when it was first seen", () => {
    const env = scratchEnv();
    legacyState(env);
    recordOutsideAgent(
      { id: "claude-code-a1b2c3", name: "Claude Code", instance: "p1" },
      2_000,
      env,
    );
    const rows = listOutsideAgents(env);
    expect(rows.map((row) => row.id)).toEqual(["claude-code-a1b2c3"]);
    expect(rows[0]?.firstSeenAt).toBe(500);
  });

  it("keeps Who it knows written for a2a:claude-code for every Claude Code session", () => {
    const cfg = {
      agents: { entries: { "builder-oak": { agentToAgent: { deny: ["a2a:claude-code"] } } } },
    } as unknown as BranchConfig;
    expect(outsideAgentMayMessage(cfg, "builder-oak", "claude-code-a1b2c3")).toBe(false);
    expect(outsideAgentMayMessage(cfg, "builder-oak", "claude-code-d4e5f6-2")).toBe(false);
    expect(outsideAgentMayMessage(cfg, "builder-elm", "claude-code-a1b2c3")).toBe(true);
    expect(outsideAgentMayMessage(cfg, "builder-oak", "hermes-agent-a1b2c3")).toBe(true);
  });

  it("keeps Disconnect and window rights written for the old id, and one session's change splits them", () => {
    const env = scratchEnv();
    legacyState(env);
    recordOutsideAgent(
      { id: "claude-code-a1b2c3", name: "Claude Code", instance: "p1" },
      2_000,
      env,
    );
    recordOutsideAgent(
      { id: "claude-code-d4e5f6", name: "Claude Code", instance: "p2" },
      2_100,
      env,
    );
    let settings = readOutsideAgentSettings(env);
    expect(outsideAgentMayDriveWindow("claude-code-a1b2c3", settings)).toBe(true);
    expect(outsideAgentMayDriveWindow("claude-code-d4e5f6", settings)).toBe(true);
    settings = updateOutsideAgentSettings({ id: "claude-code-a1b2c3", mayDriveWindow: false }, env);
    expect(settings.mayDriveWindow).toEqual(["claude-code-d4e5f6"]);
    expect(outsideAgentMayDriveWindow("claude-code-a1b2c3", settings)).toBe(false);
    expect(outsideAgentMayDriveWindow("claude-code-d4e5f6", settings)).toBe(true);
    updateOutsideAgentSettings({ id: "claude-code", revoked: true }, env);
    expect(
      outsideAgentRefusal(
        { id: "claude-code-d4e5f6", name: "Claude Code" },
        readOutsideAgentSettings(env),
      ),
    ).toMatch(/disconnected/);
  });
});
