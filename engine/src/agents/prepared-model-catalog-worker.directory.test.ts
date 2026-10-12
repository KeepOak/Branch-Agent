import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { captureGroveInstallSchemaVersionFacts } from "../groves/provenance-runtime-read.js";
import "../groves/tool-policy-runtime.js";
import type { BranchConfig } from "../config/types.branch.js";
import {
  closeBranchStateDatabaseByPathAsync,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import { unregisterResolvedAgentDir } from "./agent-dir-registry.js";
import { resolveAgentDir } from "./agent-scope-config.js";
import { saveAuthProfileStore } from "./auth-profiles/store-runtime.js";
import { createPreparedModelCatalogWorkerInput } from "./prepared-model-catalog-worker.js";
import {
  createCatalogFixture,
  EXTERNAL_AUTH_PATH_ENV,
  PROVIDER_ID,
  REF_ONLY_API_ENV,
  REF_ONLY_TOKEN_ENV,
} from "./prepared-model-catalog-worker.test-support.js";
import { prepareWorkspaceBuildGroup } from "./prepared-model-runtime.facts.js";
import { retainPreparedPluginGeneration } from "./prepared-model-runtime.plugin-lifetime.js";
import { createCatalogInspectionPool } from "./test-helpers/prepared-model-catalog-inspection.js";
import { usePreparedCatalogWorkerFixtures } from "./test-helpers/prepared-model-catalog-worker-fixture.js";

const { makeTempDir, retireAfterTest } = usePreparedCatalogWorkerFixtures();

async function createFixture() {
  const fixture = await createCatalogFixture(makeTempDir, 0);
  for (const name of [
    "BRANCH_DISABLE_BUNDLED_PLUGINS",
    "BRANCH_STATE_DIR",
    "BRANCH_WORKER_CATALOG_MARKER",
    EXTERNAL_AUTH_PATH_ENV,
    REF_ONLY_API_ENV,
    REF_ONLY_TOKEN_ENV,
  ] as const) {
    vi.stubEnv(name, fixture.env[name]);
  }
  return fixture;
}

describe("catalog request existing directory ownership", () => {
  beforeEach(() => {
    vi.stubEnv("CODEX_HOME", makeTempDir("branch-directory-request-empty-codex-"));
  });

  it("serves repeated catalog requests from prepared provenance without copying shared state", async () => {
    const fixture = await createFixture();
    const prepared = await prepareWorkspaceBuildGroup(
      [{ agentId: "main", agentDir: fixture.agentDir, config: fixture.config, env: fixture.env }],
      "static",
    );
    retireAfterTest(retainPreparedPluginGeneration(prepared.pluginGeneration));
    const value = createPreparedModelCatalogWorkerInput({
      agentFacts: prepared.agentFacts[0]!,
      pluginMetadataSnapshot: prepared.pluginGeneration.pluginMetadataSnapshot,
    });
    const database = openBranchStateDatabase({ env: fixture.env });
    const groveInstallSchemaVersions = captureGroveInstallSchemaVersionFacts({ env: fixture.env });
    await closeBranchStateDatabaseByPathAsync(database.path);
    const { pool } = createCatalogInspectionPool(fixture.env);
    try {
      for (let tick = 0; tick < 3; tick++) {
        const { inspection, ...result } = await pool.run(
          {
            value,
            request: { kind: "catalog", syntheticAuth: [], groveInstallSchemaVersions },
            ...(tick === 0 ? { inspection: { copyProbePath: database.path } } : {}),
          },
          { timeoutMs: 30_000 },
        );
        expect(result).toMatchObject({
          status: "ok",
          kind: "catalog",
          snapshot: {
            entries: expect.arrayContaining([
              expect.objectContaining({ provider: PROVIDER_ID, id: "plugin-generation-v1" }),
            ]),
          },
        });
        expect(inspection.sqliteCopies).toBe(0);
        if (tick === 0) {
          expect(inspection.copyHookObserved).toBe(true);
        }
      }
    } finally {
      await pool.close();
      await closeBranchStateDatabaseByPathAsync(database.path);
    }
  });

  it.each([
    { label: "same normalized owner", existing: ["MAIN"], conflict: false },
    { label: "foreign owner", existing: ["foreign"], conflict: true },
    { label: "ambiguous owners", existing: ["main", "foreign"], conflict: true },
  ])("preserves $label across the request", async ({ existing, conflict }) => {
    const fixture = await createFixture();
    const config = {
      ...fixture.config,
      agents: {
        ...fixture.config.agents,
        entries: { main: { agentDir: path.join(fixture.root, "custom-owner", "agent") } },
      },
    } satisfies BranchConfig;
    const agentDir = resolveAgentDir(config, "main", fixture.env);
    retireAfterTest(() => {
      unregisterResolvedAgentDir({ agentId: "main", agentDir, env: fixture.env });
      unregisterResolvedAgentDir({ agentId: "foreign", agentDir, env: fixture.env });
    });
    saveAuthProfileStore(
      {
        version: 1,
        profiles: {
          [`${PROVIDER_ID}:main`]: {
            type: "api_key",
            provider: PROVIDER_ID,
            key: "existing-owner-key-not-real",
          },
        },
      },
      agentDir,
    );
    const prepared = await prepareWorkspaceBuildGroup(
      [{ agentId: "main", agentDir, inheritedAuthDir: agentDir, config, env: fixture.env }],
      "static",
    );
    retireAfterTest(retainPreparedPluginGeneration(prepared.pluginGeneration));
    const value = structuredClone(
      createPreparedModelCatalogWorkerInput({
        agentFacts: prepared.agentFacts[0]!,
        pluginMetadataSnapshot: prepared.pluginGeneration.pluginMetadataSnapshot,
      }),
    );
    unregisterResolvedAgentDir({ agentId: "main", agentDir, env: fixture.env });
    const { pool } = createCatalogInspectionPool(fixture.env);
    let completed: Awaited<ReturnType<typeof pool.run>>;
    try {
      completed = await pool.run(
        {
          value,
          request: {
            kind: "catalog",
            syntheticAuth: [],
            groveInstallSchemaVersions: captureGroveInstallSchemaVersionFacts({ env: fixture.env }),
          },
          inspection: { existingAgentIds: existing },
        },
        { timeoutMs: 30_000 },
      );
    } finally {
      await pool.close();
    }
    const { inspection, ...result } = completed;
    if (conflict) {
      expect(result).toEqual({
        status: "failed",
        error: `Conflicting registered agent owners for ${agentDir}`,
      });
      expect(fs.existsSync(fixture.marker)).toBe(false);
      expect(inspection.foreignReleased).toBe(true);
    } else {
      expect(result).toMatchObject({
        status: "ok",
        kind: "catalog",
        snapshot: {
          entries: expect.arrayContaining([
            expect.objectContaining({ provider: PROVIDER_ID, id: "plugin-generation-v1" }),
          ]),
        },
      });
      expect(fs.readFileSync(fixture.marker, "utf8")).toBe("start\ndone\n");
    }
    expect(inspection.registeredAgentId).toBe(
      existing.some((agentId) => agentId.toLowerCase() === "main") ? "main" : undefined,
    );
  });
});
