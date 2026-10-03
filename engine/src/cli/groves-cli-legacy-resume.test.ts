import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { buildGroveAddPlan } from "../groves/lifecycle.js";
import { persistGroveInstallRecord } from "../groves/provenance.js";
import { readGroveManifestFile } from "../groves/reader.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";

const mocks = vi.hoisted(() => ({
  logs: [] as string[],
  runtime: {
    log: vi.fn(),
    error: vi.fn(),
    writeJson: vi.fn((value: unknown) => mocks.logs.push(JSON.stringify(value))),
    writeStdout: vi.fn(),
    exit: vi.fn((code: number) => {
      throw new Error(`__exit__:${code}`);
    }),
  },
  loadConfig: vi.fn<() => Record<string, unknown>>(() => ({})),
  listConfiguredMcpServers: vi.fn(),
  applyGroveAddPlan: vi.fn(),
  preflightClawPackage: vi.fn(),
}));

vi.mock("../runtime.js", async () => ({
  ...(await vi.importActual<typeof import("../runtime.js")>("../runtime.js")),
  defaultRuntime: mocks.runtime,
  writeRuntimeJson: (runtime: typeof mocks.runtime, value: unknown) => runtime.writeJson(value),
}));
vi.mock("../config/config.js", async () => ({
  ...(await vi.importActual<typeof import("../config/config.js")>("../config/config.js")),
  getRuntimeConfig: mocks.loadConfig,
}));
vi.mock("../config/mcp-config.js", () => ({
  listConfiguredMcpServers: mocks.listConfiguredMcpServers,
}));
vi.mock("../groves/add.js", async () => ({
  ...(await vi.importActual<typeof import("../groves/add.js")>("../groves/add.js")),
  applyGroveAddPlan: mocks.applyGroveAddPlan,
}));
vi.mock("../groves/packages.js", async () => ({
  ...(await vi.importActual<typeof import("../groves/packages.js")>("../groves/packages.js")),
  preflightClawPackage: mocks.preflightClawPackage,
}));

const { runGrovesAddCommand } = await import("./groves-cli.runtime.js");
const tempDirs = useAutoCleanupTempDirTracker(afterEach);

beforeEach(() => {
  vi.stubEnv("BRANCH_EXPERIMENTAL_GROVES", "1");
  mocks.logs.length = 0;
  mocks.loadConfig.mockReset();
  mocks.listConfiguredMcpServers.mockResolvedValue({ ok: true, path: "config", mcpServers: {} });
  mocks.applyGroveAddPlan.mockReset();
  mocks.applyGroveAddPlan.mockResolvedValue({
    schemaVersion: "branch.groveAddResult.v1",
    stability: "experimental",
    status: "complete",
    agent: { finalId: "demo-agent", workspace: "" },
  });
});

afterEach(() => {
  closeBranchStateDatabaseForTest();
  vi.unstubAllEnvs();
});

describe("groves add legacy v1 resume", () => {
  it.each(["coding", "minimal"] as const)(
    "retries an exact committed dynamic %s-profile add through the bounded migration",
    async (toolProfile) => {
      const root = tempDirs.make("branch-groves-v1-profile-resume-");
      const workspace = join(root, "workspace");
      vi.stubEnv("BRANCH_STATE_DIR", join(tempDirs.make("branch-state-"), "state"));
      await mkdir(join(root, "profiles"));
      const manifestPath = join(root, "branch.grove.json");
      await writeFile(
        manifestPath,
        JSON.stringify({ schemaVersion: 1, agent: { id: "demo-agent", name: "Demo Agent" } }),
        "utf8",
      );
      await writeFile(
        join(root, "profiles", "branch.yml"),
        `schemaVersion: 1\nagent:\n  tools:\n    profile: ${toolProfile}\n`,
        "utf8",
      );
      const read = await readGroveManifestFile(manifestPath, {
        allowLegacyDynamicToolProfile: true,
      });
      if (!read.ok || !read.legacyBranchProfile) {
        throw new Error("expected legacy dynamic profile evidence");
      }
      const legacyPlan = await buildGroveAddPlan({
        manifest: read.manifest,
        branchProfile: read.legacyBranchProfile,
        reconstructLegacyDynamicToolProfilePlan: true,
        source: read.source,
        context: { workspace, packagePreflight: mocks.preflightClawPackage },
      });
      persistGroveInstallRecord(legacyPlan, { status: "workspace_ready", nowMs: 1 });
      openBranchStateDatabase()
        .db /* sqlite-allow-raw: test-only downgrade simulates a pre-v2 interrupted add. */
        .prepare("UPDATE grove_installs SET schema_version = ? WHERE agent_id = ?")
        .run("branch.groveInstallRecord.v1", "demo-agent");
      await mkdir(workspace);
      let config = { agents: { list: [legacyPlan.agent.config] } };
      mocks.loadConfig.mockImplementation(() => config);
      mocks.applyGroveAddPlan.mockImplementationOnce(async (boundedPlan) => {
        config = { agents: { list: [boundedPlan.agent.config] } };
        return {
          schemaVersion: "branch.groveAddResult.v1",
          stability: "experimental",
          status: "partial",
          agent: boundedPlan.agent,
        };
      });

      await expect(
        runGrovesAddCommand(manifestPath, {
          yes: true,
          planIntegrity: legacyPlan.planIntegrity,
          workspace,
          json: true,
        }),
      ).rejects.toThrow("__exit__:1");
      await runGrovesAddCommand(manifestPath, {
        yes: true,
        planIntegrity: legacyPlan.planIntegrity,
        workspace,
        json: true,
      });

      expect(mocks.applyGroveAddPlan).toHaveBeenLastCalledWith(
        expect.objectContaining({
          planIntegrity: expect.not.stringMatching(legacyPlan.planIntegrity),
          agent: expect.objectContaining({
            config: expect.objectContaining({
              tools: expect.objectContaining({
                profile: "full",
                allow: expect.not.arrayContaining(["bundle-mcp"]),
              }),
            }),
          }),
        }),
        expect.objectContaining({
          consentPlanIntegrity: legacyPlan.planIntegrity,
          resumePlan: expect.objectContaining({ planIntegrity: legacyPlan.planIntegrity }),
          resumeRecord: expect.objectContaining({
            schemaVersion: "branch.groveInstallRecord.v1",
          }),
        }),
      );
    },
  );
});
