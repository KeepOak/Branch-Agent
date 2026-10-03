import fs from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { loadPersistedSharedAuthProfileStore } from "../agents/auth-profiles/persisted.js";
import { deletePersistedAuthProfileStoreRaw } from "../agents/auth-profiles/sqlite.js";
import { writeConfigMachineState } from "../state/config-machine-state-write.js";
import { closeBranchAgentDatabasesForTest } from "../state/branch-agent-db.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import {
  createBranchTestState,
  type BranchTestState,
} from "../test-utils/branch-test-state.js";
import { maybeMigrateAuthProfileJsonStoresToSqlite } from "./doctor-auth-flat-profiles.js";

let state: BranchTestState;

afterEach(async () => {
  vi.restoreAllMocks();
  closeBranchAgentDatabasesForTest();
  closeBranchStateDatabaseForTest();
  await state?.cleanup();
});

it.each([
  ["legacy-main", "auth-profiles.json"],
  ["legacy-main", "auth.json"],
  ["state-db", "auth-profiles.json"],
  ["state-db", "auth.json"],
] as const)("recovers %s credentials after interrupted %s archival", async (location, filename) => {
  state = await createBranchTestState({ layout: "state-only" });
  if (location === "state-db") {
    writeConfigMachineState("auth.sharedStore", { location }, { env: state.env });
  }
  const credential = { type: "api_key", provider: "openai", key: "synthetic-migration-key" };
  const source = await state.writeJson(
    `agents/main/agent/${filename}`,
    filename === "auth-profiles.json"
      ? { version: 1, profiles: { "openai:default": credential } }
      : { openai: credential },
  );
  const sourceBytes = fs.readFileSync(source);
  const migrate = () =>
    maybeMigrateAuthProfileJsonStoresToSqlite({
      cfg: {},
      prompter: { confirmAutoFix: async () => true },
      env: state.env,
    });
  const rename = fs.renameSync;
  const interruptedRename = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
    rename(from, to);
    if (String(from) === source) {
      throw new Error("simulated interruption after archive rename");
    }
  });
  const interrupted = await migrate();
  interruptedRename.mockRestore();
  expect(interrupted.warnings).toEqual([
    expect.stringContaining("simulated interruption after archive rename"),
  ]);
  expect(fs.existsSync(source)).toBe(false);
  const db = openBranchStateDatabase({ env: state.env }).db;
  expect(
    db.prepare("SELECT status FROM migration_sources WHERE source_path = ?").get(source),
  ).toEqual({ status: "imported" });

  // Model a lost destination after the import commit but before terminal completion.
  deletePersistedAuthProfileStoreRaw(location === "legacy-main" ? state.agentDir() : undefined);
  expect(loadPersistedSharedAuthProfileStore(state.env)?.profiles ?? {}).toEqual({});
  const repaired = await migrate();

  expect(repaired.warnings).toEqual([]);
  expect(loadPersistedSharedAuthProfileStore(state.env)?.profiles).toEqual({
    "openai:default": credential,
  });
  expect(repaired.changes).toContain("Reset an interrupted auth migration receipt for retry.");
  const receipt = db
    .prepare("SELECT status, report_json FROM migration_sources WHERE source_path = ?")
    .get(source) as { status: string; report_json: string };
  expect(receipt.status).toBe("completed");
  expect(fs.readFileSync(JSON.parse(receipt.report_json).archivePath)).toEqual(sourceBytes);
  expect((await migrate()).changes).toEqual([]);
});
