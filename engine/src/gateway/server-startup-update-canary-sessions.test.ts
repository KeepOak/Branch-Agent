import { expect, it, vi } from "vitest";
import { noteSessionTranscriptHealth } from "../commands/doctor-session-transcripts.js";
import { replaceSessionEntrySync } from "../config/sessions/session-accessor.js";
import { openBranchAgentDatabase } from "../state/branch-agent-db.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { runUpdateCanarySessionValidation } from "./server-startup-update-canary-sessions.js";

const ACP_META = {
  backend: "fixture",
  agent: "main",
  runtimeSessionName: "restored-runtime",
  mode: "persistent",
  state: "idle",
  lastActivityAt: 100,
};

/**
 * Fixture host: real-shaped agent data where exactly one persisted session row is invalid. "repairable" is a
 * row Doctor rewrites (duplicate embedded ACP metadata); "unrepairable" is truncated JSON Doctor cannot rebuild.
 */
async function withOneInvalidSessionRow(
  kind: "repairable" | "unrepairable",
  run: (fixture: {
    cfg: { agents: { ownership: "explicit"; entries: { main: Record<string, never> } } };
    env: NodeJS.ProcessEnv;
    sessionKey: string;
  }) => Promise<void>,
) {
  await withBranchTestState({ scenario: "empty" }, async ({ env, writeConfig }) => {
    const cfg = { agents: { ownership: "explicit" as const, entries: { main: {} } } };
    await writeConfig(cfg);
    const sessionKey = kind === "repairable" ? "agent:main:acp:unsettled" : "agent:main:broken";
    const entry = {
      sessionId: "fixture-session",
      lifecycleRevision: "fixture-revision",
      updatedAt: 100,
    };
    replaceSessionEntrySync(
      { cfg, env, agentId: "main", sessionKey: "agent:main:main" },
      {
        ...entry,
        sessionId: "healthy-session",
      },
    );
    replaceSessionEntrySync({ cfg, env, agentId: "main", sessionKey }, entry);
    const raw =
      kind === "repairable"
        ? `${JSON.stringify(entry).slice(0, -1)},"acp":null,"acp":${JSON.stringify(ACP_META)}}`
        : "{";
    const { db } = openBranchAgentDatabase({ agentId: "main", env });
    db.prepare("UPDATE session_nodes SET entry_json = ? WHERE session_key = ?").run(
      raw,
      sessionKey,
    );
    expect(
      db.prepare("SELECT entry_valid FROM session_nodes WHERE session_key = ?").get(sessionKey),
    ).toEqual({ entry_valid: 0 });
    await run({ cfg, env, sessionKey });
  });
}

async function repairWithDoctor(cfg: object, env: NodeJS.ProcessEnv) {
  await noteSessionTranscriptHealth({
    cfg,
    env,
    shouldRepair: true,
    postSessionPluginMigrationPlanBound: true,
    onWarnings: () => undefined,
  }).catch(() => undefined);
}

it("refuses the candidate on one invalid session row, and passes once Doctor repaired the copy", async () => {
  await withOneInvalidSessionRow("repairable", async ({ cfg, env, sessionKey }) => {
    const log = { info: vi.fn(), warn: vi.fn() };
    await expect(runUpdateCanarySessionValidation({ cfg, env, log })).rejects.toThrow(
      `invalid persisted session row requires repair for ${sessionKey}`,
    );
    await repairWithDoctor(cfg, env);
    await expect(runUpdateCanarySessionValidation({ cfg, env, log })).resolves.toBeUndefined();
  });
});

it("keeps refusing when Doctor cannot repair the row, so the host stays on the serving engine", async () => {
  await withOneInvalidSessionRow("unrepairable", async ({ cfg, env, sessionKey }) => {
    const log = { info: vi.fn(), warn: vi.fn() };
    await expect(runUpdateCanarySessionValidation({ cfg, env, log })).rejects.toThrow(
      `invalid persisted session row requires repair for ${sessionKey}`,
    );
    await repairWithDoctor(cfg, env);
    await expect(runUpdateCanarySessionValidation({ cfg, env, log })).rejects.toThrow(
      "requires repair",
    );
  });
});
