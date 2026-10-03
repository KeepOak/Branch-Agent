import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES } from "../agents/workspace-bootstrap-read.js";
import { readWorkspaceStateSnapshot } from "../agents/workspace-state-store.js";
import { withTempHomeConfig } from "../config/test-helpers.js";
import type { BranchConfig } from "../config/types.branch.js";
import { closeBranchStateDatabaseForTest } from "../state/branch-state-db.js";
import { setTestEnvValue } from "../test-utils/env.js";
import { applyGroveAddPlan } from "./add.js";
import { seedClawPackageBootstrap } from "./bootstrap.js";
import { quiescentGroveMonitorGateway } from "./lifecycle-remove.test-support.js";
import { applyGroveRemovePlan, buildGroveRemovePlan, readGroveStatus } from "./lifecycle-state.js";
import { buildGroveAddPlan } from "./lifecycle.js";
import {
  persistGroveInstallRecord,
  readGroveInstallRecord,
  updateGroveInstallRecord,
} from "./provenance.js";
import { readGroveManifestFile } from "./reader.js";
import { parseGroveManifest } from "./schema.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

afterEach(() => closeBranchStateDatabaseForTest());

async function createPackage(bootstrap = "# First run\n\nAsk which repositories matter.\n") {
  const root = tempDirs.make("branch-grove-bootstrap-");
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "@acme/bootstrap-worker",
      version: "1.0.0",
      branch: { grove: "GROVE.md" },
    }),
    "utf8",
  );
  await writeFile(
    join(root, "GROVE.md"),
    [
      "---",
      "schemaVersion: 1",
      "agent:",
      "  id: bootstrap-worker",
      "---",
      "",
      "# Bootstrap Worker",
      "",
      "Help with selected repositories.",
    ].join("\n"),
    "utf8",
  );
  await writeFile(join(root, "BOOTSTRAP.md"), bootstrap, "utf8");
  return root;
}

async function bootstrapPlan(options: { content?: string; includeBody?: boolean } = {}) {
  const root = await createPackage(options.content);
  const read = await readGroveManifestFile(root);
  if (!read.ok || !read.packageBootstrap) {
    throw new Error("expected package bootstrap");
  }
  const workspace = join(root, "workspace");
  const env = { BRANCH_STATE_DIR: join(root, "state") };
  const plan = await buildGroveAddPlan({
    manifest: read.manifest,
    ...(options.includeBody ? { groveMarkdownBody: read.groveMarkdownBody } : {}),
    packageBootstrap: read.packageBootstrap,
    source: read.source,
    context: { workspace },
  });
  return { read, workspace, env, plan };
}

function removeBootstrap(
  plan: Awaited<ReturnType<typeof buildGroveRemovePlan>>,
  config: BranchConfig,
  env: { BRANCH_STATE_DIR: string },
) {
  return withTempHomeConfig(config, async ({ configPath }) => {
    setTestEnvValue("BRANCH_CONFIG_PATH", configPath);
    setTestEnvValue("BRANCH_STATE_DIR", env.BRANCH_STATE_DIR);
    return applyGroveRemovePlan(plan, {
      monitorGateway: quiescentGroveMonitorGateway,
      env,
      config,
      consentPlanIntegrity: plan.planIntegrity,
      purgeSessions: async () => undefined,
      trashPath: async () => true,
    });
  });
}

describe("package-root BOOTSTRAP.md", () => {
  it("integrity-binds bootstrap and plans a distinct native action", async () => {
    const root = await createPackage();
    const first = await readGroveManifestFile(root);
    expect(first).toMatchObject({
      ok: true,
      packageBootstrap: {
        sourcePath: "BOOTSTRAP.md",
        digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    if (!first.ok || !first.packageBootstrap) {
      throw new Error("expected package bootstrap");
    }
    const plan = await buildGroveAddPlan({
      manifest: first.manifest,
      groveMarkdownBody: first.groveMarkdownBody,
      packageBootstrap: first.packageBootstrap,
      source: first.source,
      context: { workspace: join(root, "workspace") },
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({
        kind: "bootstrap",
        id: "BOOTSTRAP.md",
        action: "write",
        digest: first.packageBootstrap.digest,
        details: expect.objectContaining({ lifecycle: "native-seed-once" }),
      }),
    );

    await writeFile(join(root, "BOOTSTRAP.md"), "# Changed\n", "utf8");
    const second = await readGroveManifestFile(root);
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error("expected changed package to parse");
    }
    expect(second.source.integrity).not.toBe(first.source.integrity);
  });

  it("seeds native state once and never recreates a consumed bootstrap", async () => {
    const { workspace, env, plan } = await bootstrapPlan({ includeBody: true });
    let config: BranchConfig = {};
    const added = await applyGroveAddPlan(plan, {
      env,
      nowMs: 1_000,
      consentPlanIntegrity: plan.planIntegrity,
      commitConfig: async (transform) => {
        config = transform(config);
      },
    });

    expect(added.status).toBe("complete");
    await expect(readFile(join(workspace, "BOOTSTRAP.md"), "utf8")).resolves.toContain(
      "which repositories",
    );
    expect((await readWorkspaceStateSnapshot(workspace, { env })).setup).toMatchObject({
      bootstrapSeededAt: new Date(1_000).toISOString(),
    });
    await expect(readGroveStatus("bootstrap-worker", { env, config })).resolves.toMatchObject({
      summary: { pendingBootstrap: 1 },
      records: [{ bootstrapState: "pending" }],
    });

    await rm(join(workspace, "BOOTSTRAP.md"));
    await expect(seedClawPackageBootstrap(plan, { env, nowMs: 2_000 })).resolves.toBe("consumed");
    await expect(readFile(join(workspace, "BOOTSTRAP.md"), "utf8")).rejects.toThrow();
    await expect(readGroveStatus("bootstrap-worker", { env, config })).resolves.toMatchObject({
      summary: { pendingBootstrap: 0 },
      records: [{ bootstrapState: "complete" }],
    });
  });

  it("keeps the agent unpublished and resumable when package bootstrap seeding fails", async () => {
    const { workspace, env, plan } = await bootstrapPlan({ includeBody: true });
    let config: BranchConfig = {};

    const added = await applyGroveAddPlan(plan, {
      env,
      nowMs: 1_000,
      consentPlanIntegrity: plan.planIntegrity,
      commitConfig: async (transform) => {
        config = transform(config);
      },
      seedPackageBootstrap: async () => {
        throw new Error("seed failed");
      },
    });

    expect(added).toMatchObject({
      status: "partial",
      configCommitted: false,
      error: { code: "bootstrap_write_failed" },
    });
    expect(config).toEqual({});
    expect(readGroveInstallRecord("bootstrap-worker", { env })?.status).toBe("workspace_ready");
    expect(
      (await readWorkspaceStateSnapshot(workspace, { env })).setup.bootstrapSeededAt,
    ).toBeUndefined();
    await expect(readFile(join(workspace, "BOOTSTRAP.md"), "utf8")).rejects.toThrow();

    const resumed = await applyGroveAddPlan(plan, {
      env,
      nowMs: 2_000,
      consentPlanIntegrity: plan.planIntegrity,
      commitConfig: async (transform) => {
        config = transform(config);
      },
    });

    expect(resumed.status).toBe("complete");
    await expect(readFile(join(workspace, "BOOTSTRAP.md"), "utf8")).resolves.toContain(
      "which repositories",
    );
    await expect(readGroveStatus("bootstrap-worker", { env, config })).resolves.toMatchObject({
      records: [{ bootstrapState: "pending" }],
    });
  });

  it("recovers from a stock bootstrap seeded by a concurrent session", async () => {
    const { workspace, env, plan } = await bootstrapPlan({ includeBody: true });
    let config: BranchConfig = {};

    const added = await applyGroveAddPlan(plan, {
      env,
      nowMs: 1_000,
      consentPlanIntegrity: plan.planIntegrity,
      commitConfig: async (transform) => {
        config = transform(config);
      },
      seedPackageBootstrap: async (seedPlan, seedOptions) => {
        await writeFile(join(workspace, "BOOTSTRAP.md"), "# Stock onboarding\n", "utf8");
        return await seedClawPackageBootstrap(seedPlan, seedOptions);
      },
    });

    expect(added).toMatchObject({ status: "partial", configCommitted: false });
    expect(config).toEqual({});
    expect(readGroveInstallRecord("bootstrap-worker", { env })?.status).toBe("workspace_ready");

    await rm(join(workspace, "BOOTSTRAP.md"));
    const resumed = await applyGroveAddPlan(plan, {
      env,
      nowMs: 2_000,
      consentPlanIntegrity: plan.planIntegrity,
      commitConfig: async (transform) => {
        config = transform(config);
      },
    });

    expect(resumed.status).toBe("complete");
    await expect(readGroveStatus("bootstrap-worker", { env, config })).resolves.toMatchObject({
      records: [{ bootstrapState: "pending" }],
    });
  });

  it("does not expose the agent while package bootstrap seeding is in flight", async () => {
    const { workspace, env, plan: addPlan } = await bootstrapPlan({ includeBody: true });
    let config: BranchConfig = {};
    let releaseSeed!: () => void;
    const seedReleased = new Promise<void>((resolve) => {
      releaseSeed = resolve;
    });
    let reportSeedStarted!: () => void;
    const seedStarted = new Promise<void>((resolve) => {
      reportSeedStarted = resolve;
    });

    const addPromise = applyGroveAddPlan(addPlan, {
      env,
      consentPlanIntegrity: addPlan.planIntegrity,
      commitConfig: async (transform) => {
        config = transform(config);
      },
      seedPackageBootstrap: async (plan, options) => {
        reportSeedStarted();
        await seedReleased;
        return seedClawPackageBootstrap(plan, options);
      },
    });

    await seedStarted;
    expect(config.agents?.entries?.["bootstrap-worker"]).toBeUndefined();
    releaseSeed();

    await expect(addPromise).resolves.toMatchObject({
      status: "complete",
      configCommitted: true,
    });
    await expect(readFile(join(workspace, "BOOTSTRAP.md"), "utf8")).resolves.toContain(
      "which repositories",
    );
  });

  it("removes a seeded partial install when the later configuration commit fails", async () => {
    const { workspace, env, plan: addPlan } = await bootstrapPlan({ includeBody: true });

    const added = await applyGroveAddPlan(addPlan, {
      env,
      consentPlanIntegrity: addPlan.planIntegrity,
      commitConfig: async () => {
        throw new Error("config failed");
      },
    });

    expect(added).toMatchObject({
      status: "partial",
      configCommitted: false,
      error: { code: "config_commit_failed" },
    });
    await expect(readFile(join(workspace, "BOOTSTRAP.md"), "utf8")).resolves.toContain(
      "which repositories",
    );
    await expect(readGroveStatus("bootstrap-worker", { env, config: {} })).resolves.toMatchObject({
      records: [{ install: { status: "workspace_ready" }, bootstrapState: "pending" }],
    });
    const removePlan = await buildGroveRemovePlan("bootstrap-worker", { env, config: {} });
    expect(removePlan.blockers).toEqual([]);
    expect(removePlan.actions).toContainEqual(
      expect.objectContaining({
        kind: "bootstrap",
        action: "delete",
        blocked: false,
        details: expect.objectContaining({ expectedState: "pending" }),
      }),
    );

    const removed = await removeBootstrap(removePlan, {}, env);

    expect(removed).toMatchObject({
      status: "complete",
      bootstrap: { path: "BOOTSTRAP.md", action: "deleted" },
    });
    expect(readGroveInstallRecord("bootstrap-worker", { env })).toBeUndefined();
  });

  it("preserves bootstrap provenance when update omits the seed-once action", async () => {
    const { read, workspace, env, plan: addPlan } = await bootstrapPlan();
    const initial = persistGroveInstallRecord(addPlan, { env });
    const updatePlan = await buildGroveAddPlan({
      manifest: read.manifest,
      packageBootstrap: read.packageBootstrap,
      includePackageBootstrap: false,
      source: read.source,
      context: { workspace },
    });

    expect(updatePlan.actions.some((action) => action.kind === "bootstrap")).toBe(false);
    updateGroveInstallRecord(updatePlan, { env });

    expect(readGroveInstallRecord("bootstrap-worker", { env })?.bootstrap).toEqual(
      initial.bootstrap,
    );
  });

  it("removes an unchanged large pending bootstrap within the native size limit", async () => {
    const content = "# First run\n\n" + "x".repeat(1024 * 1024 + 32);
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES);
    const { workspace, env, plan: addPlan } = await bootstrapPlan({ content });
    let config: BranchConfig = {};
    await applyGroveAddPlan(addPlan, {
      env,
      consentPlanIntegrity: addPlan.planIntegrity,
      commitConfig: async (transform) => {
        config = transform(config);
      },
    });

    await expect(readGroveStatus("bootstrap-worker", { env, config })).resolves.toMatchObject({
      records: [{ bootstrapState: "pending" }],
    });
    const removePlan = await buildGroveRemovePlan("bootstrap-worker", { env, config });
    expect(removePlan.actions).toContainEqual(
      expect.objectContaining({ kind: "bootstrap", action: "delete", blocked: false }),
    );
    expect(removePlan.actions).toContainEqual(
      expect.objectContaining({ kind: "workspace", action: "trash" }),
    );
    const removed = await removeBootstrap(removePlan, config, env);

    expect(removed).toMatchObject({
      status: "complete",
      bootstrap: { path: "BOOTSTRAP.md", action: "deleted" },
    });
    await expect(readFile(join(workspace, "BOOTSTRAP.md"), "utf8")).rejects.toThrow();
  });

  it("preserves a locally modified pending bootstrap and its workspace", async () => {
    const { workspace, env, plan: addPlan } = await bootstrapPlan();
    let config: BranchConfig = {};
    await applyGroveAddPlan(addPlan, {
      env,
      consentPlanIntegrity: addPlan.planIntegrity,
      commitConfig: async (transform) => {
        config = transform(config);
      },
    });
    await writeFile(join(workspace, "BOOTSTRAP.md"), "# My edited onboarding\n", "utf8");

    const removePlan = await buildGroveRemovePlan("bootstrap-worker", { env, config });
    expect(removePlan.actions).toContainEqual(
      expect.objectContaining({ kind: "bootstrap", action: "retain", blocked: false }),
    );
    expect(removePlan.actions).toContainEqual(
      expect.objectContaining({ kind: "workspace", action: "retain" }),
    );
    const removed = await removeBootstrap(removePlan, config, env);

    expect(removed).toMatchObject({
      status: "complete",
      bootstrap: { path: "BOOTSTRAP.md", action: "retainedModified" },
    });
    await expect(readFile(join(workspace, "BOOTSTRAP.md"), "utf8")).resolves.toContain(
      "My edited onboarding",
    );
  });

  it("rejects an empty package bootstrap", async () => {
    const root = await createPackage(" \n\t");

    await expect(readGroveManifestFile(root)).resolves.toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "package_bootstrap_empty" })],
    });
  });

  it.each(["BOOTSTRAP.md", "BOOTSTRAP.md/notes.md", "bootstrap.md/notes.md"])(
    "reserves %s for the native seed-once lifecycle",
    (path) => {
      const result = parseGroveManifest({
        schemaVersion: 1,
        agent: { id: "bootstrap-worker" },
        workspace: {
          files: [{ source: "assets/BOOTSTRAP.md", path }],
        },
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          path: "$.workspace.files[0].path",
          message: expect.stringContaining("native seed-once lifecycle"),
        }),
      );
    },
  );
});
