import fs from "node:fs/promises";
import path from "node:path";
import { withTempHome } from "branch/plugin-sdk/test-env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  prepareSystemAgentRunAdmission,
  resolveAdmittedRunActiveAssertion,
} from "../agents/admitted-run-context.js";
import {
  readConfigFileSnapshot,
  replaceConfigFile,
  resetConfigRuntimeState,
} from "../config/config.js";
import { migrateLegacyMainSessionKeys } from "../config/sessions/legacy-main-session-migration.js";
import { readExactSessionEntryRowForCanonicalRepair } from "../config/sessions/session-accessor.sqlite-canonical-repair.js";
import { writeSessionEntry } from "../config/sessions/session-accessor.sqlite-entry-store.js";
import { readTranscriptEventRows } from "../config/sessions/session-accessor.sqlite-read.js";
import { appendTranscriptEventInTransaction } from "../config/sessions/session-accessor.sqlite-transcript-store.js";
import { runSessionStartupMigration } from "../config/sessions/startup-migration.js";
import { resetAgentRunRegistryForTest } from "../infra/agent-run-registry.js";
import {
  beginAgentDeletionJournal,
  completeAgentDeletionJournalInDatabase,
  readAgentDeletionJournal,
} from "../state/agent-deletion-journal.js";
import { readAgentProvenance } from "../state/agent-provenance.js";
import {
  closeBranchAgentDatabasesForTest,
  openBranchAgentDatabase,
  runBranchAgentWriteTransaction,
} from "../state/branch-agent-db.js";
import { withExistingBranchStateDatabaseReadOnly } from "../state/branch-state-db-readonly.js";
import {
  closeBranchStateDatabaseForTest,
  runBranchStateWriteTransaction,
} from "../state/branch-state-db.js";
import { captureEnv, deleteTestEnvValue, setTestEnvValue } from "../test-utils/env.js";
import { ensureOnboardingAgent } from "./onboard-agent.js";

const migrationWindow = vi.hoisted(() => ({
  afterPublication: undefined as (() => void) | undefined,
}));
vi.mock("../config/config.js", async (original) => {
  const actual = await original<typeof import("../config/config.js")>();
  return {
    ...actual,
    readConfigFileSnapshot: async () => {
      const snapshot = await actual.readConfigFileSnapshot();
      if (snapshot.config.agents?.entries?.robby) {
        const afterPublication = migrationWindow.afterPublication;
        migrationWindow.afterPublication = undefined;
        afterPublication?.();
      }
      return snapshot;
    },
  };
});

describe("onboarding authored config persistence", () => {
  let envSnapshot: ReturnType<typeof captureEnv>;

  beforeEach(() => {
    envSnapshot = captureEnv(["BRANCH_AGENT_DIR", "BRANCH_STATE_DIR", "BRANCH_TOKEN"]);
  });

  afterEach(() => {
    migrationWindow.afterPublication = undefined;
    resetAgentRunRegistryForTest();
    envSnapshot.restore();
    closeBranchAgentDatabasesForTest();
    closeBranchStateDatabaseForTest();
    resetConfigRuntimeState();
  });

  it.each(["sourceConfig", "config"] as const)(
    "creates a named first agent from %s while retaining authored env references and includes",
    async (configShape) => {
      await withTempHome(async (rawHome) => {
        const home = await fs.realpath(rawHome);
        const configDir = path.join(home, ".branch");
        const configPath = path.join(configDir, "branch.json");
        const includePath = path.join(configDir, "channels.json");
        const includeRaw = JSON.stringify({ channels: { telegram: { enabled: true } } });
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(includePath, includeRaw);
        await fs.writeFile(
          configPath,
          `{
          $include: "./channels.json",
          gateway: { auth: { mode: "token", token: "\${BRANCH_TOKEN}" } }
        }`,
        );
        setTestEnvValue("BRANCH_TOKEN", "plaintext-secret");
        resetConfigRuntimeState();

        const snapshot = await readConfigFileSnapshot();
        const baseConfig = snapshot[configShape];
        const candidate = {
          ...baseConfig,
          gateway: { ...baseConfig.gateway, mode: "local" as const },
        };
        const result = await ensureOnboardingAgent({
          config: candidate,
          workspace: path.join(home, "workspace"),
          baseConfig,
          firstAgent: { name: "roster-proof" },
        });
        await replaceConfigFile({ nextConfig: result.config, afterWrite: { mode: "auto" } });

        const persistedRaw = await fs.readFile(configPath, "utf8");
        expect(result).toMatchObject({ agentId: "roster-proof", createdAgent: true });
        expect(JSON.parse(persistedRaw).agents.entries).toEqual({
          "roster-proof": expect.objectContaining({
            name: "roster-proof",
            workspace: path.join(home, "workspace"),
          }),
        });
        expect(persistedRaw).toContain("${BRANCH_TOKEN}");
        expect(persistedRaw).not.toContain("plaintext-secret");
        expect(persistedRaw).toContain("./channels.json");
        expect(await fs.readFile(includePath, "utf8")).toBe(includeRaw);
      });
    },
  );

  it.each([
    { entries: { existing: { name: "Existing" } } },
    { entries: { main: {} } },
    { list: [{ id: "main", default: true }] },
    {
      list: [
        { id: "alpha", default: true, model: "fixture/alpha" },
        { id: "beta", model: "fixture/beta" },
      ],
    },
  ])("leaves an existing roster config byte-identical: %j", async (agents) => {
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".branch");
      const configPath = path.join(configDir, "branch.json");
      const raw = `${JSON.stringify({ agents }, null, 2)}\n`;
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(configPath, raw);
      resetConfigRuntimeState();
      const snapshot = await readConfigFileSnapshot();

      const result = await ensureOnboardingAgent({
        config: snapshot.config,
        workspace: path.join(home, "workspace"),
        firstAgent: { name: "ignored" },
      });

      expect(result.createdAgent).toBe(false);
      expect(result.config.agents?.entries).toEqual(snapshot.config.agents?.entries);
      expect(snapshot.sourceConfigBeforeMigrations?.agents).toEqual(agents);
      expect(snapshot.sourceConfig.agents?.list).toBeUndefined();
      expect(await fs.readFile(configPath, "utf8")).toBe(raw);
    });
  });

  it("reports legacy session repairs without migrating during first-agent onboarding", async () => {
    await withTempHome(async (rawHome) => {
      const home = await fs.realpath(rawHome);
      const stateDir = path.join(home, ".branch");
      setTestEnvValue("BRANCH_STATE_DIR", stateDir);
      deleteTestEnvValue("BRANCH_AGENT_DIR");
      resetConfigRuntimeState();
      await replaceConfigFile({ nextConfig: {}, afterWrite: { mode: "auto" } });

      const legacyKey = "agent:main:main";
      const legacyDatabasePath = path.join(
        stateDir,
        "agents",
        "main",
        "agent",
        "branch-agent.sqlite",
      );
      const entry = { sessionId: "legacy-main-session", updatedAt: Date.now() };
      runBranchAgentWriteTransaction(
        (database) => {
          writeSessionEntry(database, legacyKey, entry, {
            allowStoredAliases: true,
            previousEntry: null,
          });
          appendTranscriptEventInTransaction(
            database,
            {
              agentId: "main",
              path: legacyDatabasePath,
              sessionId: entry.sessionId,
              sessionKey: legacyKey,
            },
            { type: "message", text: "legacy history" },
            { allowStoredAlias: true },
          );
        },
        { agentId: "main", path: legacyDatabasePath },
      );

      const result = await ensureOnboardingAgent({
        config: {},
        workspace: path.join(stateDir, "workspace"),
        firstAgent: { name: "robby" },
      });
      const ownerDatabasePath = path.join(
        stateDir,
        "agents",
        "robby",
        "agent",
        "branch-agent.sqlite",
      );
      const readEntry = (databasePath: string, agentId: string, key: string) =>
        runBranchAgentWriteTransaction(
          (database) => readExactSessionEntryRowForCanonicalRepair(database, key)?.entry,
          { agentId, path: databasePath },
        );

      expect(result.agentId).toBe("robby");
      expect.soft(await fs.stat(ownerDatabasePath).catch(() => null)).toBeNull();
      expect.soft(readEntry(legacyDatabasePath, "main", legacyKey)).toMatchObject(entry);
      expect(result.sessionMigrationWarnings).toEqual([
        expect.stringContaining("branch doctor --fix"),
      ]);
      expect(
        withExistingBranchStateDatabaseReadOnly(
          ({ db }) =>
            db
              .prepare(
                "SELECT status FROM migration_sources WHERE source_key = 'legacy-main-session-keys'",
              )
              .get() as { status: string },
        ),
      ).toBeUndefined();
    });
  });

  it.each(["locked", "closed after publication"] as const)(
    "preserves history when %s until an explicit Doctor repair",
    async (boundary) => {
      await withTempHome(async (rawHome) => {
        const home = await fs.realpath(rawHome);
        const stateDir = path.join(home, ".branch");
        setTestEnvValue("BRANCH_STATE_DIR", stateDir);
        deleteTestEnvValue("BRANCH_AGENT_DIR");
        resetConfigRuntimeState();
        await replaceConfigFile({ nextConfig: {}, afterWrite: { mode: "auto" } });

        const legacyKey = "agent:main:main";
        const canonicalKey = "agent:robby:main";
        const legacyDatabasePath = path.join(
          stateDir,
          "agents",
          "main",
          "agent",
          "branch-agent.sqlite",
        );
        const entry = { sessionId: "locked-legacy-session", updatedAt: 100 };
        runBranchAgentWriteTransaction(
          (database) => {
            writeSessionEntry(database, legacyKey, entry, {
              allowStoredAliases: true,
              previousEntry: null,
            });
            appendTranscriptEventInTransaction(
              database,
              {
                agentId: "main",
                path: legacyDatabasePath,
                sessionId: entry.sessionId,
                sessionKey: legacyKey,
              },
              { type: "message", text: "locked history" },
              { allowStoredAlias: true },
            );
          },
          { agentId: "main", path: legacyDatabasePath },
        );
        const sourceDatabase = openBranchAgentDatabase({
          agentId: "main",
          path: legacyDatabasePath,
        });
        const admission = prepareSystemAgentRunAdmission({}, "onboard-migration", "main", "setup");
        const beforePersistentApply = resolveAdmittedRunActiveAssertion(
          await admission.admit("embedded"),
        )!;
        const beforeRows = readTranscriptEventRows(sourceDatabase, entry.sessionId);
        if (boundary === "locked") {
          sourceDatabase.db.exec("BEGIN IMMEDIATE");
        } else {
          beginAgentDeletionJournal({
            agentId: "robby",
            operationId: "previous-robby",
            deleteFiles: false,
            agentDir: path.join(stateDir, "agents", "robby", "agent"),
            sessionsDir: path.join(stateDir, "agents", "robby", "sessions"),
            workspaceDir: path.join(stateDir, "workspace"),
          });
          runBranchStateWriteTransaction((sharedStateDatabase) =>
            completeAgentDeletionJournalInDatabase(sharedStateDatabase, "robby", "previous-robby"),
          );
          migrationWindow.afterPublication = () => {
            beforePersistentApply();
            admission.close();
          };
        }
        let result: Awaited<ReturnType<typeof ensureOnboardingAgent>> | undefined;
        let failure: unknown;
        try {
          result = await ensureOnboardingAgent({
            config: {},
            workspace: path.join(stateDir, "workspace"),
            firstAgent: { name: "robby" },
            beforePersistentApply,
          });
        } catch (error) {
          failure = error;
        } finally {
          if (boundary === "locked") {
            sourceDatabase.db.exec("ROLLBACK");
          }
          admission.close();
        }

        expect(failure).toBeUndefined();
        expect(result?.agentId).toBe("robby");
        expect(result?.sessionMigrationWarnings).toEqual([
          expect.stringContaining("branch doctor --fix"),
        ]);
        if (boundary === "closed after publication") {
          expect(readAgentDeletionJournal("robby")).toBeUndefined();
          expect(readAgentProvenance("robby")).toMatchObject({ createdVia: "operator" });
        }
        expect(
          readExactSessionEntryRowForCanonicalRepair(sourceDatabase, legacyKey)?.entry,
        ).toMatchObject(entry);
        expect(readTranscriptEventRows(sourceDatabase, entry.sessionId)).toEqual(beforeRows);
        expect(
          await fs
            .stat(path.join(stateDir, "agents", "robby", "agent", "branch-agent.sqlite"))
            .catch(() => null),
        ).toBeNull();
        const readLedgerStatus = () =>
          withExistingBranchStateDatabaseReadOnly(
            ({ db }) =>
              db
                .prepare(
                  "SELECT status FROM migration_sources WHERE source_key = 'legacy-main-session-keys'",
                )
                .get() as { status: string } | undefined,
          );
        expect.soft(readLedgerStatus()).toBeUndefined();
        const published = await readConfigFileSnapshot();
        expect(Object.keys(published.config.agents?.entries ?? {})).toEqual(["robby"]);
        const log = { info: vi.fn(), warn: vi.fn() };
        await runSessionStartupMigration({
          cfg: published.config,
          env: process.env,
          log,
          deps: {
            resolveAllAgentSessionStoreTargetsSync: () => [],
          },
        });
        const ownerDatabasePath = path.join(
          stateDir,
          "agents",
          "robby",
          "agent",
          "branch-agent.sqlite",
        );
        const readEntry = (databasePath: string, agentId: string, key: string) =>
          runBranchAgentWriteTransaction(
            (database) => readExactSessionEntryRowForCanonicalRepair(database, key)?.entry,
            { agentId, path: databasePath },
          );

        expect(readEntry(legacyDatabasePath, "main", legacyKey)).toMatchObject(entry);
        expect(await fs.stat(ownerDatabasePath).catch(() => null)).toBeNull();
        expect(readLedgerStatus()).toBeUndefined();
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("branch doctor --fix"));
        await migrateLegacyMainSessionKeys({
          cfg: published.config,
          env: process.env,
          mode: "doctor-fix",
        });
        expect(readEntry(ownerDatabasePath, "robby", canonicalKey)).toMatchObject(entry);
        expect(readEntry(legacyDatabasePath, "main", legacyKey)).toBeUndefined();
        expect(readLedgerStatus()).toEqual({ status: "completed" });
      });
    },
  );
});
