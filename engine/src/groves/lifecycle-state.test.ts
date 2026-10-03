import { link, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { loadConfig } from "../config/config.js";
import type { BranchConfig } from "../config/types.branch.js";
import { cronJobReadView } from "../cron/job-read-view.js";
import { normalizeCronJobCreate } from "../cron/normalize.js";
import { upsertCronJobRow } from "../cron/store/row-codec.js";
import type { CronStoredJob } from "../cron/types.js";
import { readAgentDeletionJournal } from "../state/agent-deletion-journal.js";
import {
  listBranchRegisteredAgentDatabases,
  registerBranchAgentDatabase,
} from "../state/branch-agent-db-registry.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import {
  createBranchTestState,
  type BranchTestState,
} from "../test-utils/branch-test-state.js";
import { groveCronGatewayInput, markGroveCronRefRemoved, readGroveCronRefs } from "./cron.js";
import { withGroveAgentConfigRemoval } from "./lifecycle-config-removal.js";
import { quiescentGroveMonitorGateway } from "./lifecycle-remove.test-support.js";
import { applyGroveRemovePlan, buildGroveRemovePlan, readGroveStatus } from "./lifecycle-state.js";
import { createGroveRemoveTestFixtures } from "./lifecycle-state.test-helpers.js";
import { digestGroveMcpServer, readGroveMcpServerRefs, upsertGroveMcpServerRef } from "./mcp.js";
import {
  persistGroveInstallRecord,
  persistClawPackageRef,
  readClawPackageRefs,
} from "./provenance.js";

let state: BranchTestState;
beforeEach(async () => {
  state = await createBranchTestState({ prefix: "grove-remove-config-" });
  await state.writeConfig({});
});
afterEach(async () => {
  closeBranchStateDatabaseForTest();
  await state.cleanup();
});
const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const { fixture, addFixture } = createGroveRemoveTestFixtures(tempDirs, () => state);

function removeOptions(
  current: Awaited<ReturnType<typeof addFixture>>,
  plan: Parameters<typeof applyGroveRemovePlan>[0],
  config = current.getConfig(),
) {
  return {
    monitorGateway: quiescentGroveMonitorGateway,
    trashPath: async () => true,
    consentPlanIntegrity: plan.planIntegrity,
    env: current.env,
    config,
  };
}

const packageIntegrity = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function cronReadView(agentId: string, ref: ReturnType<typeof readGroveCronRefs>[number]) {
  const normalized = normalizeCronJobCreate(groveCronGatewayInput(agentId, ref));
  if (!normalized || !ref.schedulerJobId) {
    throw new Error("expected complete cron provenance");
  }
  return cronJobReadView({
    ...normalized,
    id: ref.schedulerJobId,
    createdAtMs: 1,
    updatedAtMs: 1,
    state: { nextRunAtMs: 100, lastRunAtMs: 50, lastStatus: "ok" },
  });
}

function seedAttachedCronJob(
  env: NodeJS.ProcessEnv,
  job: Pick<CronStoredJob, "id" | "name" | "schedule">,
): void {
  const database = openBranchStateDatabase({ env });
  upsertCronJobRow(
    database.db,
    "default",
    {
      ...job,
      agentId: "worker",
      owner: { agentId: "worker" },
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Run scheduled job" },
      state: {},
    },
    0,
  );
}

describe("Grove status and remove", () => {
  it("previews locally without probing Gateway when there are no attached jobs, but never applies without one", async () => {
    const current = await addFixture({ withFile: true });
    const inspect = vi.fn(async () => {
      throw new Error("Gateway offline");
    });
    const plan = await buildGroveRemovePlan("worker", {
      env: current.env,
      config: current.getConfig(),
      monitorGateway: { ...quiescentGroveMonitorGateway, inspect },
    });
    expect(plan.blockers).toEqual([]);
    expect(inspect).not.toHaveBeenCalled();
    await expect(
      applyGroveRemovePlan(plan, {
        env: current.env,
        config: current.getConfig(),
        consentPlanIntegrity: plan.planIntegrity,
      }),
    ).rejects.toMatchObject({ code: "monitor_gateway_required" });
    await expect(readFile(join(current.plan.agent.workspace, "SOUL.md"), "utf8")).resolves.toBe(
      "managed\n",
    );
  });

  it("does not reconcile pending MCP provenance before rejecting remove without Gateway", async () => {
    const current = await addFixture();
    const server = { command: "docs-mcp", args: [] };
    const mcpOptions = {
      listMcpServers: async () => ({
        ok: true as const,
        path: "config",
        config: {},
        mcpServers: { docs: server },
        runtimeConfig: current.getConfig(),
        sourceConfigBeforeMigrations: current.getConfig(),
      }),
    };
    const ref = {
      schemaVersion: "branch.groveMcpServerRef.v1" as const,
      agentId: "worker",
      name: "docs",
      configDigest: digestGroveMcpServer(server),
      relationship: "managed" as const,
      origin: "grove-introduced" as const,
      independentOwner: false,
      status: "complete" as const,
      createdAtMs: 1,
      updatedAtMs: 1,
    };
    upsertGroveMcpServerRef(ref, { env: current.env });
    const config = current.getConfig();
    const plan = await buildGroveRemovePlan("worker", {
      env: current.env,
      config,
      ...mcpOptions,
    });
    upsertGroveMcpServerRef({ ...ref, status: "pending" }, { env: current.env });

    await expect(
      applyGroveRemovePlan(plan, {
        env: current.env,
        config,
        consentPlanIntegrity: plan.planIntegrity,
        ...mcpOptions,
      }),
    ).rejects.toMatchObject({ code: "monitor_gateway_required" });
    expect(readGroveMcpServerRefs("worker", { env: current.env })).toMatchObject([
      { name: "docs", status: "pending" },
    ]);
  });

  it("rejects cleanup when an expected-missing agent id was recreated", async () => {
    await expect(
      withGroveAgentConfigRemoval(
        {
          agentId: "worker",
          expectedDigest: "sha256:missing",
          expectedRemovalSurfaceDigest: "sha256:unused",
          expectedState: "missing",
          fallbackWorkspace: "/tmp/old-worker",
          config: { agents: { entries: { worker: { workspace: "/tmp/new-worker" } } } },
          onModified: () => new Error("agent recreated"),
        },
        (commitRemoval) => commitRemoval(),
      ),
    ).rejects.toThrow("agent recreated");
  });

  it("reports installed agent, managed files, and package references", async () => {
    const current = await addFixture({ withFile: true });
    persistClawPackageRef(
      current.plan,
      {
        kind: "plugin",
        source: "clawhub",
        ref: "audit",
        version: "2.0.0",
        integrity: packageIntegrity,
      },
      { env: current.env, nowMs: 2 },
    );
    const status = await readGroveStatus("worker", {
      env: current.env,
      config: current.getConfig(),
    });
    expect(status).toMatchObject({
      summary: {
        groves: 1,
        partial: 0,
        missingAgents: 0,
        driftedFiles: 0,
        packageRefs: 1,
        missingPackages: 1,
      },
      records: [
        {
          install: { agentId: "worker", grove: { name: "@acme/worker" } },
          agentState: "present",
          workspaceFiles: [{ path: "SOUL.md", state: "unchanged" }],
          packages: [{ kind: "plugin", ref: "audit", state: "missing" }],
        },
      ],
    });
  });

  it("reports adapter identity drift for an installed extension without mutating provenance", async () => {
    const current = await addFixture();
    const extension = {
      id: "audit-tools",
      format: "claude" as const,
      detectedFormat: "claude" as const,
      mapped: ["skills"],
      unavailable: ["agents"],
      adapterIdentity: "branch/previous",
    };
    persistClawPackageRef(
      current.plan,
      {
        kind: "plugin",
        source: "clawhub",
        ref: "audit",
        version: "2.0.0",
        integrity: packageIntegrity,
        extension,
      },
      { env: current.env, nowMs: 2, relationship: "referenced" },
    );

    const status = await readGroveStatus("worker", {
      env: current.env,
      config: current.getConfig(),
      packageDeps: {
        resolvePlugin: async () => ({
          status: "found" as const,
          pluginId: "audit",
          installedVersion: "2.0.0",
          record: { source: "clawhub", integrity: packageIntegrity },
        }),
      },
    });

    expect(status.summary.driftedPackages).toBe(1);
    expect(status.records[0]?.packages[0]).toMatchObject({
      state: "present",
      extension,
      extensionCompatibility: {
        state: "drifted",
        mapped: ["agents", "skills"],
        unavailable: [],
        adapterIdentity: "branch/v1",
      },
    });
    expect(readClawPackageRefs({ env: current.env })[0]?.extension).toEqual(extension);
  });

  it("reports unavailable extension inspection separately from package drift", async () => {
    const current = await addFixture();
    const extension = {
      id: "audit-tools",
      format: "claude" as const,
      detectedFormat: "claude" as const,
      mapped: ["skills"],
      unavailable: ["agents"],
      adapterIdentity: "branch/current",
    };
    persistClawPackageRef(
      current.plan,
      {
        kind: "plugin",
        source: "clawhub",
        ref: "audit",
        version: "2.0.0",
        integrity: packageIntegrity,
        extension,
      },
      { env: current.env, nowMs: 2, relationship: "referenced" },
    );

    const status = await readGroveStatus("worker", {
      env: current.env,
      config: current.getConfig(),
      packageDeps: {
        resolvePlugin: async () => ({
          status: "found" as const,
          pluginId: "audit",
          installedVersion: "2.0.0",
          record: { source: "clawhub", integrity: packageIntegrity },
        }),
      },
      packagePreflight: async () => ({
        ok: false,
        code: "extension_unavailable",
        message: "Canonical extension inspection is unavailable.",
      }),
    });

    expect(status.summary).toMatchObject({ driftedPackages: 0, unavailableExtensions: 1 });
    expect(status.records[0]?.packages[0]).toMatchObject({
      state: "present",
      extensionCompatibility: {
        state: "unavailable",
        message: "Canonical extension inspection is unavailable.",
      },
    });
  });

  it("counts every non-complete root install as partial", async () => {
    const current = await fixture();
    persistGroveInstallRecord(current.plan, { env: current.env, status: "config_committed" });

    await expect(
      readGroveStatus("worker", { env: current.env, config: { agents: { entries: {} } } }),
    ).resolves.toMatchObject({ summary: { groves: 1, partial: 1 } });
  });

  it("reports orphaned subordinate ownership without a root install row", async () => {
    const current = await fixture();
    persistClawPackageRef(
      current.plan,
      {
        kind: "plugin",
        source: "clawhub",
        ref: "audit",
        version: "2.0.0",
        integrity: packageIntegrity,
      },
      { env: current.env, nowMs: 2 },
    );

    await expect(readGroveStatus("worker", { env: current.env, config: {} })).resolves.toMatchObject(
      {
        summary: { groves: 1, partial: 1, missingAgents: 1, packageRefs: 1 },
        records: [
          {
            orphaned: true,
            install: { agentId: "worker", status: "partial" },
            packages: [{ ref: "audit", state: "missing" }],
          },
        ],
      },
    );

    const remove = await buildGroveRemovePlan("worker", { env: current.env, config: {} });
    const removed = await applyGroveRemovePlan(remove, {
      monitorGateway: quiescentGroveMonitorGateway,
      trashPath: async () => true,
      env: current.env,
      config: {},
      consentPlanIntegrity: remove.planIntegrity,
      purgeSessions: async () => undefined,
    });
    expect(removed).toMatchObject({ status: "complete", agentRemoved: false });
    await expect(readGroveStatus("worker", { env: current.env, config: {} })).resolves.toMatchObject(
      {
        summary: { groves: 0 },
      },
    );
  });

  it("previews all canonical agent config deletion effects", async () => {
    const current = await addFixture();
    const config: BranchConfig = {
      ...current.getConfig(),
      bindings: [{ match: { channel: "telegram", accountId: "*" }, agentId: "worker" }],
      tools: { agentToAgent: { allow: ["worker"] } },
    } as BranchConfig;

    const plan = await buildGroveRemovePlan("worker", { env: current.env, config });

    expect(plan.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "agent", target: 'agents.entries["worker"]' }),
        expect.objectContaining({ kind: "configBinding", target: "bindings[agentId=worker]" }),
        expect.objectContaining({ kind: "agentAllow", target: "tools.agentToAgent.allow[worker]" }),
        expect.objectContaining({ kind: "workspace", action: "trash" }),
        expect.objectContaining({ kind: "agentState", action: "trash" }),
        expect.objectContaining({ kind: "sessionIndex", action: "delete" }),
        expect.objectContaining({ kind: "sessionTranscripts", action: "trash" }),
      ]),
    );
  });

  it("refuses changed bindings and retains the cleanup fence", async () => {
    const current = await addFixture();
    const config: BranchConfig = {
      ...current.getConfig(),
      bindings: [{ match: { channel: "telegram", accountId: "first" }, agentId: "worker" }],
    } as BranchConfig;
    const plan = await buildGroveRemovePlan("worker", { env: current.env, config });
    const changedConfig: BranchConfig = {
      ...config,
      bindings: [{ match: { channel: "telegram", accountId: "second" }, agentId: "worker" }],
    } as BranchConfig;

    await expect(
      applyGroveRemovePlan(plan, {
        monitorGateway: {
          ...quiescentGroveMonitorGateway,
          quiesce: async () => {
            await state.writeConfig(changedConfig);
          },
        },
        env: current.env,
        config,
        consentPlanIntegrity: plan.planIntegrity,
      }),
    ).resolves.toMatchObject({
      status: "partial",
      agentRemoved: false,
      error: { code: "agent_modified" },
    });
    expect(readAgentDeletionJournal("worker", { env: current.env })).toMatchObject({
      cleanupCompleted: false,
    });
  });

  it("keeps Grove-owned cron removal actions separate from independent jobs", async () => {
    const current = await addFixture({ withCron: true });
    seedAttachedCronJob(current.env, {
      id: "scheduler-daily",
      name: "Grove job",
      schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
    });
    for (const id of ["z-operator-job", "a-operator-job"]) {
      seedAttachedCronJob(current.env, {
        id,
        name: "Operator job",
        schedule: { kind: "every", everyMs: 60_000 },
      });
    }

    const plan = await buildGroveRemovePlan("worker", {
      env: current.env,
      config: current.getConfig(),
    });
    const independentIds = ["a-operator-job", "z-operator-job"];
    expect(plan.blockers).toEqual(
      independentIds.map((id) => ({
        code: "agent_job_attached",
        message: expect.stringContaining(JSON.stringify(id)),
      })),
    );
    expect(plan.actions.filter((action) => action.kind === "scheduledJob")).toEqual(
      independentIds.map((id) => expect.objectContaining({ id, action: "retain", blocked: true })),
    );
    expect(plan.actions.filter((action) => action.kind === "cronJob")).toEqual([
      expect.objectContaining({
        id: "daily-report",
        target: "scheduler-daily",
        action: "remove",
        blocked: false,
      }),
    ]);
  });

  it("removes the agent and unchanged files but only releases package refs", async () => {
    const current = await addFixture({ withFile: true });
    const databasePath = join(
      current.env.BRANCH_STATE_DIR,
      "agents",
      "worker",
      "agent",
      "branch-agent.sqlite",
    );
    registerBranchAgentDatabase({ agentId: "worker", path: databasePath, env: current.env });
    persistClawPackageRef(
      current.plan,
      {
        kind: "skill",
        source: "clawhub",
        ref: "triage",
        version: "1.0.0",
        integrity: packageIntegrity,
      },
      { env: current.env },
    );
    const plan = await buildGroveRemovePlan("worker", {
      env: current.env,
      config: current.getConfig(),
    });
    const config = current.getConfig();
    const result = await applyGroveRemovePlan(plan, {
      ...removeOptions(current, plan, config),
    });
    expect(result).toMatchObject({
      status: "complete",
      agentRemoved: true,
      packageRefsReleased: 1,
      workspaceFiles: [{ path: "SOUL.md", action: "deleted" }],
    });
    expect(loadConfig().agents?.entries?.worker).toBeUndefined();
    expect(
      listBranchRegisteredAgentDatabases({ env: current.env }).map((entry) => entry.agentId),
    ).not.toContain("worker");
    await expect(readFile(join(current.plan.agent.workspace, "SOUL.md"), "utf8")).rejects.toThrow();
    await expect(
      readGroveStatus("worker", { env: current.env, config: loadConfig() }),
    ).resolves.toMatchObject({
      summary: { groves: 0 },
    });
  });

  it("removes scheduler-owned cron jobs before agent config", async () => {
    const current = await addFixture({ withCron: true });
    const plan = await buildGroveRemovePlan("worker", {
      env: current.env,
      config: current.getConfig(),
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({
        kind: "cronJob",
        id: "daily-report",
        action: "remove",
        target: "scheduler-daily",
      }),
    );
    const config = current.getConfig();
    const order: string[] = [];
    const result = await applyGroveRemovePlan(plan, {
      ...removeOptions(current, plan, config),
      cronGateway: {
        get: async () =>
          cronReadView("worker", readGroveCronRefs("worker", { env: current.env })[0]!),
        remove: async (id) => {
          expect(loadConfig().agents?.entries?.worker).toBeDefined();
          order.push(`cron:${id}`);
          return { ok: true };
        },
      },
    });
    expect(order).toEqual(["cron:scheduler-daily"]);
    expect(loadConfig().agents?.entries?.worker).toBeUndefined();
    expect(result).toMatchObject({
      status: "complete",
      cronJobs: [
        { manifestId: "daily-report", schedulerJobId: "scheduler-daily", action: "removed" },
      ],
    });
  });

  it("accepts scheduler defaults when removing a Grove cron job", async () => {
    const current = await addFixture({ withCron: true });
    const plan = await buildGroveRemovePlan("worker", {
      env: current.env,
      config: current.getConfig(),
    });
    const ref = readGroveCronRefs("worker", { env: current.env })[0]!;
    const live = cronReadView("worker", ref);
    const remove = vi.fn().mockResolvedValue({ ok: true });

    const result = await applyGroveRemovePlan(plan, {
      ...removeOptions(current, plan),
      cronGateway: {
        get: async () => ({
          ...live,
          payload: { ...live.payload, toolsAllow: ["*"] },
          scheduledToolPolicy: { version: 1, mode: "trusted" },
        }),
        remove,
      },
    });

    expect(remove).toHaveBeenCalledWith(ref.schedulerJobId);
    expect(result).toMatchObject({
      status: "complete",
      agentRemoved: true,
      cronJobs: [{ manifestId: "daily-report", action: "removed" }],
    });
  });

  it("fails removal planning when source MCP config cannot be read", async () => {
    const current = await addFixture({ withCron: true });

    await expect(
      buildGroveRemovePlan("worker", {
        env: current.env,
        config: current.getConfig(),
        listMcpServers: async () => ({
          ok: false,
          path: "config",
          error: "Config file is invalid.",
        }),
      }),
    ).rejects.toMatchObject({ code: "mcp_config_unavailable" });
  });

  it("retains the agent when recurring work cannot be disabled", async () => {
    const current = await addFixture({ withCron: true });
    const plan = await buildGroveRemovePlan("worker", {
      env: current.env,
      config: current.getConfig(),
    });
    const result = await applyGroveRemovePlan(plan, {
      ...removeOptions(current, plan),
      cronGateway: {
        get: async () =>
          cronReadView("worker", readGroveCronRefs("worker", { env: current.env })[0]!),
        remove: async () => {
          throw new Error("scheduler unavailable");
        },
      },
    });

    expect(result).toMatchObject({
      status: "partial",
      agentRemoved: false,
      error: { code: "cron_cleanup_failed", message: "scheduler unavailable" },
      cronJobs: [{ manifestId: "daily-report", action: "error" }],
    });
  });

  it("reconciles a lost cron.remove response when the gateway confirms absence", async () => {
    const current = await addFixture({ withCron: true });
    const plan = await buildGroveRemovePlan("worker", {
      env: current.env,
      config: current.getConfig(),
    });
    const ref = readGroveCronRefs("worker", { env: current.env })[0]!;
    let present = true;
    const config = current.getConfig();

    const result = await applyGroveRemovePlan(plan, {
      ...removeOptions(current, plan, config),
      cronGateway: {
        get: async () => (present ? cronReadView("worker", ref) : undefined),
        remove: async () => {
          present = false;
          throw new Error("response lost");
        },
      },
    });

    expect(result).toMatchObject({
      status: "complete",
      cronJobs: [{ manifestId: "daily-report", action: "removed" }],
    });
  });

  it("preserves a live cron job that changed after planning", async () => {
    const current = await addFixture({ withCron: true });
    const plan = await buildGroveRemovePlan("worker", {
      env: current.env,
      config: current.getConfig(),
    });
    const remove = vi.fn();

    const result = await applyGroveRemovePlan(plan, {
      ...removeOptions(current, plan),
      cronGateway: {
        get: async () => ({
          ...cronReadView("worker", readGroveCronRefs("worker", { env: current.env })[0]!),
          schedule: { kind: "cron", expr: "0 12 * * *", tz: "UTC" },
        }),
        remove,
      },
    });

    expect(result).toMatchObject({
      status: "partial",
      agentRemoved: false,
      error: { code: "cron_cleanup_failed", message: expect.stringContaining("changed") },
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("finishes local cleanup without repeating a confirmed remote cron removal", async () => {
    const current = await addFixture({ withCron: true });
    markGroveCronRefRemoved("worker", "daily-report", { env: current.env });
    const plan = await buildGroveRemovePlan("worker", {
      env: current.env,
      config: current.getConfig(),
    });
    const config = current.getConfig();
    const remoteRemovals: string[] = [];

    const result = await applyGroveRemovePlan(plan, {
      ...removeOptions(current, plan, config),
      cronGateway: {
        remove: async (id) => {
          remoteRemovals.push(id);
          return { ok: true };
        },
      },
    });

    expect(remoteRemovals).toEqual([]);
    expect(result).toMatchObject({
      status: "complete",
      cronJobs: [{ manifestId: "daily-report", action: "removed" }],
    });
  });

  it("preserves modified files while releasing their provenance", async () => {
    const current = await addFixture({ withFile: true });
    const target = join(current.plan.agent.workspace, "SOUL.md");
    await writeFile(target, "operator edit\n", "utf8");
    const plan = await buildGroveRemovePlan("worker", {
      env: current.env,
      config: current.getConfig(),
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ kind: "workspace", action: "retain" }),
    );
    const trashPath = vi.fn().mockResolvedValue(true);
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ kind: "workspaceFile", action: "retain", blocked: false }),
    );
    const config = current.getConfig();
    const result = await applyGroveRemovePlan(plan, {
      monitorGateway: quiescentGroveMonitorGateway,
      consentPlanIntegrity: plan.planIntegrity,
      env: current.env,
      config,
      trashPath,
    });
    expect(result.workspaceFiles).toEqual([{ path: "SOUL.md", action: "retainedModified" }]);
    await expect(readFile(target, "utf8")).resolves.toBe("operator edit\n");
    expect(trashPath).not.toHaveBeenCalledWith(current.plan.agent.workspace, expect.anything());
  });

  it("preserves a workspace containing operator-created files", async () => {
    const current = await addFixture({ withFile: true });
    const operatorFile = join(current.plan.agent.workspace, "operator-notes.md");
    await writeFile(operatorFile, "keep me\n", "utf8");
    const config = current.getConfig();
    const plan = await buildGroveRemovePlan("worker", { env: current.env, config });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({ kind: "workspace", action: "retain" }),
    );
    const trashPath = vi.fn().mockResolvedValue(true);

    await expect(
      applyGroveRemovePlan(plan, {
        monitorGateway: quiescentGroveMonitorGateway,
        env: current.env,
        config,
        consentPlanIntegrity: plan.planIntegrity,
        purgeSessions: async () => undefined,
        trashPath,
      }),
    ).resolves.toMatchObject({ status: "complete" });
    await expect(readFile(operatorFile, "utf8")).resolves.toBe("keep me\n");
    expect(trashPath).not.toHaveBeenCalledWith(current.plan.agent.workspace, expect.anything());
  });

  it("retains a replacement introduced after planning instead of deleting it", async () => {
    const current = await addFixture({ withFile: true });
    const target = join(current.plan.agent.workspace, "SOUL.md");
    const plan = await buildGroveRemovePlan("worker", {
      env: current.env,
      config: current.getConfig(),
    });
    const config = current.getConfig();

    const result = await applyGroveRemovePlan(plan, {
      monitorGateway: {
        ...quiescentGroveMonitorGateway,
        drain: async () => {
          expect(loadConfig().agents?.entries?.worker).toBeUndefined();
          await writeFile(target, "replacement\n", "utf8");
        },
      },
      trashPath: async () => true,
      consentPlanIntegrity: plan.planIntegrity,
      env: current.env,
      config,
    });

    expect(result).toMatchObject({
      status: "complete",
      workspaceFiles: [{ path: "SOUL.md", action: "retainedModified" }],
    });
    await expect(readFile(target, "utf8")).resolves.toBe("replacement\n");
  });
  it("keeps the install ledger when workspace cleanup becomes unsafe after config commit", async () => {
    const current = await addFixture({ withFile: true });
    const target = join(current.plan.agent.workspace, "SOUL.md");
    const plan = await buildGroveRemovePlan("worker", {
      env: current.env,
      config: current.getConfig(),
    });
    const config = current.getConfig();

    const result = await applyGroveRemovePlan(plan, {
      monitorGateway: {
        ...quiescentGroveMonitorGateway,
        drain: async () => {
          expect(loadConfig().agents?.entries?.worker).toBeUndefined();
          await rm(target);
          await link(join(current.root, "SOUL.md"), target);
        },
      },
      trashPath: async () => true,
      consentPlanIntegrity: plan.planIntegrity,
      env: current.env,
      config,
    });

    expect(result).toMatchObject({
      status: "partial",
      agentRemoved: true,
      workspaceFiles: [{ path: "SOUL.md", action: "error" }],
      error: { code: "workspace_cleanup_failed" },
    });
    await expect(
      readGroveStatus("worker", { env: current.env, config: loadConfig() }),
    ).resolves.toMatchObject({
      summary: { groves: 1, missingAgents: 1 },
      records: [{ install: { status: "partial" }, workspaceFiles: [{ state: "unsafe" }] }],
    });
  });

  it("purges session indexes and keeps provenance when canonical trash cleanup fails", async () => {
    const current = await addFixture();
    const config = current.getConfig();
    const plan = await buildGroveRemovePlan("worker", { env: current.env, config });
    let purgedAgentId: string | undefined;

    const result = await applyGroveRemovePlan(plan, {
      monitorGateway: quiescentGroveMonitorGateway,
      consentPlanIntegrity: plan.planIntegrity,
      env: current.env,
      config,
      purgeSessions: async (_cfg, agentId) => {
        purgedAgentId = agentId;
      },
      trashPath: async () => false,
    });

    expect(purgedAgentId).toBe("worker");
    expect(result).toMatchObject({
      status: "partial",
      agentRemoved: true,
      error: { code: "workspace_cleanup_failed" },
    });
    await expect(
      readGroveStatus("worker", { env: current.env, config: loadConfig() }),
    ).resolves.toMatchObject({ records: [{ install: { status: "partial" } }] });
  });

  it("releases global plugin references without uninstalling the plugin", async () => {
    const current = await addFixture();
    persistClawPackageRef(
      current.plan,
      {
        kind: "plugin",
        source: "clawhub",
        ref: "audit",
        version: "1.0.0",
        integrity: packageIntegrity,
      },
      {
        env: current.env,
        relationship: "referenced",
        origin: "grove-introduced",
        independentOwner: false,
      },
    );
    const config = current.getConfig();
    const resolvePlugin = vi.fn().mockResolvedValue({
      status: "found",
      pluginId: "audit",
      record: { source: "clawhub", integrity: packageIntegrity },
      installedVersion: "1.0.0",
    });
    const packageDeps = {
      resolvePlugin,
      acquirePackageLease: vi.fn(() => ({ heartbeat: vi.fn(), release: vi.fn() })),
    };
    const plan = await buildGroveRemovePlan("worker", {
      env: current.env,
      config,
      packageDeps,
    });
    expect(plan.actions).toContainEqual(
      expect.objectContaining({
        kind: "packageRef",
        action: "release",
        reason: expect.stringContaining("Grove add introduced this shared requirement"),
        details: expect.objectContaining({ introducedByGroveAdd: true }),
      }),
    );

    await expect(
      applyGroveRemovePlan(plan, {
        ...removeOptions(current, plan, config),
        packageDeps,
      }),
    ).resolves.toMatchObject({ status: "complete", agentRemoved: true });
  });

  it("blocks removal when the created agent config changed", async () => {
    const current = await addFixture();
    const config = current.getConfig();
    const agent = config.agents!.entries!.worker!;
    config.agents!.entries!.worker = { ...agent, name: "Operator edit" };
    const plan = await buildGroveRemovePlan("worker", { env: current.env, config });
    expect(plan.blockers).toContainEqual(expect.objectContaining({ code: "agent_modified" }));
    await expect(
      applyGroveRemovePlan(plan, {
        ...removeOptions(current, plan, config),
      }),
    ).rejects.toMatchObject({
      code: "remove_blocked",
    });
  });

  it("rejects removal consent for a different plan identity", async () => {
    const current = await addFixture();
    const config = current.getConfig();
    const plan = await buildGroveRemovePlan("worker", { env: current.env, config });

    await expect(
      applyGroveRemovePlan(plan, {
        monitorGateway: quiescentGroveMonitorGateway,
        trashPath: async () => true,
        env: current.env,
        config,
        consentPlanIntegrity: "sha256:stale",
      }),
    ).rejects.toMatchObject({ code: "plan_integrity_mismatch" });
  });

  it("requires an agent id when a package identity has multiple installs", async () => {
    const first = await fixture({ id: "worker-a", name: "@acme/shared" });
    const second = await fixture({ id: "worker-b", name: "@acme/shared" });
    persistGroveInstallRecord(first.plan, { env: first.env });
    persistGroveInstallRecord(second.plan, { env: first.env });
    const plan = await buildGroveRemovePlan("@acme/shared", { env: first.env, config: {} });
    expect(plan.blockers).toContainEqual(expect.objectContaining({ code: "grove_ambiguous" }));
  });

  it("keeps Grove-introduced plugin origin on every surviving Grove reference", async () => {
    const first = await fixture({ id: "worker-a", name: "@acme/first" });
    const second = await fixture({ id: "worker-b", name: "@acme/second" });
    persistGroveInstallRecord(first.plan, { env: first.env, nowMs: 1 });
    persistGroveInstallRecord(second.plan, { env: first.env, nowMs: 2 });
    const plugin = {
      kind: "plugin",
      source: "clawhub",
      ref: "audit",
      version: "1.0.0",
      integrity: packageIntegrity,
    } as const;
    persistClawPackageRef(first.plan, plugin, {
      env: first.env,
      nowMs: 1,
      relationship: "referenced",
      origin: "grove-introduced",
      independentOwner: false,
    });
    persistClawPackageRef(second.plan, plugin, {
      env: first.env,
      nowMs: 2,
      relationship: "referenced",
      origin: "grove-introduced",
      independentOwner: false,
    });
    const { id: firstId, ...firstConfig } = first.plan.agent.config;
    const { id: secondId, ...secondConfig } = second.plan.agent.config;
    const config: BranchConfig = {
      agents: { entries: { [firstId]: firstConfig, [secondId]: secondConfig } },
    };
    await state.writeConfig(config);
    const remove = await buildGroveRemovePlan("worker-a", { env: first.env, config });
    await applyGroveRemovePlan(remove, {
      monitorGateway: quiescentGroveMonitorGateway,
      trashPath: async () => true,
      consentPlanIntegrity: remove.planIntegrity,
      env: first.env,
      config,
    });

    expect(readClawPackageRefs({ env: first.env, agentId: "worker-b" })).toMatchObject([
      {
        ref: "audit",
        relationship: "referenced",
        origin: "grove-introduced",
        independentOwner: false,
      },
    ]);
  });
});
