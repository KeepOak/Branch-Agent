import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateCronAddParams } from "../../packages/gateway-protocol/src/index.js";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { cronJobReadView } from "../cron/job-read-view.js";
import { normalizeCronJobCreate } from "../cron/normalize.js";
import {
  closeBranchStateDatabaseForTest,
  openBranchStateDatabase,
} from "../state/branch-state-db.js";
import {
  groveCronGatewayInput,
  groveCronGatewayJobMatchesRef,
  deleteGroveCronRef,
  installGroveCronJobs,
  markGroveCronRefRemoved,
  readGroveCronRefs,
  upsertGroveCronRef,
} from "./cron.js";
import { buildGroveAddPlan } from "./lifecycle.js";
import { parseGroveManifest } from "./schema.js";
import type { GroveSourceIdentity } from "./types.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => closeBranchStateDatabaseForTest());

async function fixture() {
  const root = tempDirs.make("branch-grove-cron-");
  const parsed = parseGroveManifest({
    schemaVersion: 1,
    agent: { id: "worker" },
    cronJobs: [
      {
        id: "daily-report",
        name: "Daily report",
        schedule: { cron: "0 9 * * *", timezone: "UTC" },
        session: "main",
        message: "Prepare the report",
        delivery: { mode: "announce", channel: "last" },
      },
    ],
  });
  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.diagnostics));
  }

  const source: GroveSourceIdentity = {
    kind: "package",
    name: "@acme/worker",
    version: "1.0.0",
    packageRoot: root,
    manifestPath: join(root, "branch.grove.json"),
    integrityKind: "artifact",
    integrity: "sha256:manifest",
    byteLength: 100,
  };
  const plan = await buildGroveAddPlan({
    manifest: parsed.manifest,
    source,
    context: { workspace: join(root, "workspace"), agentId: "worker-two" },
  });
  return { root, plan, env: { BRANCH_STATE_DIR: join(root, "state") } };
}

function listedCronJob(
  agentId: string,
  ref: ReturnType<typeof readGroveCronRefs>[number],
  id: string,
) {
  const normalized = normalizeCronJobCreate(groveCronGatewayInput(agentId, ref));
  if (!normalized) {
    throw new Error("expected normalized cron job");
  }
  return cronJobReadView({
    ...normalized,
    id,
    createdAtMs: 1,
    updatedAtMs: 1,
    state: {
      nextRunAtMs: 100,
      lastRunAtMs: 50,
      lastStatus: "error",
      lastError: "Synthetic run error",
      lastDelivered: false,
      lastDeliveryStatus: "not-delivered",
      lastDeliveryError: "Synthetic delivery error",
      deliverySuppressionReason: "channel_transform",
      lastFailureNotificationDelivered: false,
      lastFailureNotificationDeliveryStatus: "not-delivered",
      lastFailureNotificationDeliveryError: "Synthetic notification error",
    },
  });
}

describe("installGroveCronJobs", () => {
  it("pins declarations and execution to the final agent id", async () => {
    const current = await fixture();
    const calls: string[] = [];
    const waitUntilAgentAvailable = vi.fn(async () => {
      calls.push("wait");
    });
    const add = vi.fn(async (_input: Record<string, unknown>) => {
      calls.push("add");
      return { id: "scheduler-123" };
    });

    const refs = await installGroveCronJobs(current.plan, {
      env: current.env,
      gateway: { add, waitUntilAgentAvailable },
      nowMs: 42,
    });

    expect(waitUntilAgentAvailable).toHaveBeenCalledWith("worker-two");
    expect(calls).toEqual(["wait", "add"]);
    expect(add).toHaveBeenCalledWith({
      name: "Daily report",
      declarationKey: "grove:worker-two:daily-report",
      displayName: "Daily report",
      owner: { agentId: "worker-two" },
      enabled: true,
      agentId: "worker-two",
      schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
      sessionTarget: "session:agent:worker-two:main",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Prepare the report" },
      delivery: { mode: "announce", channel: "last" },
    });
    expect(validateCronAddParams(add.mock.calls[0]?.[0])).toBe(true);
    expect(refs).toMatchObject([
      {
        schemaVersion: "branch.groveCronRef.v1",
        agentId: "worker-two",
        manifestId: "daily-report",
        schedulerJobId: "scheduler-123",
        status: "complete",
      },
    ]);
    expect(readGroveCronRefs("worker-two", { env: current.env })).toEqual(refs);
  });

  it("does not require the gateway when every cron reference is already complete", async () => {
    const current = await fixture();
    await installGroveCronJobs(current.plan, {
      env: current.env,
      gateway: { add: vi.fn().mockResolvedValue({ id: "scheduler-123" }) },
    });
    const waitUntilAgentAvailable = vi.fn().mockRejectedValue(new Error("gateway unavailable"));
    const add = vi.fn();

    await expect(
      installGroveCronJobs(current.plan, {
        env: current.env,
        gateway: { add, waitUntilAgentAvailable },
      }),
    ).resolves.toMatchObject([{ schedulerJobId: "scheduler-123", status: "complete" }]);
    expect(waitUntilAgentAvailable).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it("fails closed when a complete scheduler job disappeared", async () => {
    const current = await fixture();
    await installGroveCronJobs(current.plan, {
      env: current.env,
      gateway: { add: vi.fn().mockResolvedValue({ id: "scheduler-123" }) },
    });
    const list = vi.fn().mockResolvedValue({ jobs: [] });
    const add = vi.fn();

    await expect(
      installGroveCronJobs(current.plan, {
        env: current.env,
        gateway: { add, list },
      }),
    ).rejects.toMatchObject({ code: "cron_reconcile_conflict" });

    expect(list).toHaveBeenCalledOnce();
    expect(add).not.toHaveBeenCalled();
    expect(readGroveCronRefs("worker-two", { env: current.env })).toMatchObject([
      { schedulerJobId: "scheduler-123", status: "complete" },
    ]);
  });

  it("reconciles an unchanged completed job from a status-rich Gateway view", async () => {
    const current = await fixture();
    const refs = await installGroveCronJobs(current.plan, {
      env: current.env,
      gateway: { add: async () => ({ id: "scheduler-123" }) },
    });
    const view = {
      ...listedCronJob("worker-two", refs[0]!, "scheduler-123"),
      effectiveAgentId: "worker-two",
    };
    const before = structuredClone(view);
    const add = vi.fn();

    await expect(
      installGroveCronJobs(current.plan, {
        env: current.env,
        gateway: { add, list: async () => ({ jobs: [view] }) },
      }),
    ).resolves.toEqual(refs);
    expect(add).not.toHaveBeenCalled();
    expect(view).toEqual(before);
    for (const invalid of [
      null,
      false,
      "job",
      {},
      { ...view, state: undefined },
      { ...view, id: undefined },
      { ...view, schedule: undefined },
      { ...view, payload: { kind: "invalid" } },
    ]) {
      expect(groveCronGatewayJobMatchesRef("worker-two", refs[0]!, invalid)).toBe(false);
    }
  });

  it.each([
    {
      name: "message",
      patch: { payload: { kind: "agentTurn", message: "Different declaration" } },
    },
    { name: "unknown definition field", patch: { operatorSetting: { mode: "changed" } } },
  ])("rejects a same-key scheduler job with drifted $name", async ({ patch }) => {
    const current = await fixture();
    await installGroveCronJobs(current.plan, {
      env: current.env,
      gateway: { add: vi.fn().mockResolvedValue({ id: "scheduler-123" }) },
    });
    const [ref] = readGroveCronRefs("worker-two", { env: current.env });
    const drifted = listedCronJob("worker-two", ref!, "scheduler-123");
    Object.assign(drifted, patch);
    const add = vi.fn();

    await expect(
      installGroveCronJobs(current.plan, {
        env: current.env,
        gateway: { add, list: vi.fn().mockResolvedValue({ jobs: [drifted] }) },
      }),
    ).rejects.toMatchObject({ code: "cron_reconcile_conflict" });
    expect(add).not.toHaveBeenCalled();
  });

  it("preserves the pending reference when agent readiness fails", async () => {
    const current = await fixture();
    const add = vi.fn();

    await expect(
      installGroveCronJobs(current.plan, {
        env: current.env,
        gateway: {
          add,
          waitUntilAgentAvailable: vi.fn().mockRejectedValue(new Error("reload timed out")),
        },
      }),
    ).rejects.toMatchObject({
      code: "cron_install_failed",
      cronJobs: [{ manifestId: "daily-report", status: "pending", error: "reload timed out" }],
    });
    expect(add).not.toHaveBeenCalled();
    expect(readGroveCronRefs("worker-two", { env: current.env })).toMatchObject([
      { manifestId: "daily-report", status: "pending", error: "reload timed out" },
    ]);
  });

  it("reconciles a response-lost retry by declaration key", async () => {
    const current = await fixture();
    const add = vi.fn().mockRejectedValue(new Error("response lost"));

    await expect(
      installGroveCronJobs(current.plan, {
        env: current.env,
        gateway: { add },
      }),
    ).rejects.toMatchObject({
      code: "cron_install_failed",
      cronJobs: [{ manifestId: "daily-report", status: "pending", error: "response lost" }],
    });

    expect(readGroveCronRefs("worker-two", { env: current.env })).toMatchObject([
      { manifestId: "daily-report", status: "pending", error: "response lost" },
    ]);

    const refs = await installGroveCronJobs(current.plan, {
      env: current.env,
      gateway: {
        add,
        list: vi.fn().mockResolvedValue({
          jobs: [
            {
              id: "scheduler-after-lost-response",
              declarationKey: "grove:worker-two:daily-report",
            },
          ],
        }),
      },
    });

    expect(add).toHaveBeenCalledTimes(1);
    expect(refs).toMatchObject([
      { schedulerJobId: "scheduler-after-lost-response", status: "complete" },
    ]);
    expect(refs[0]).not.toHaveProperty("error");
    expect(refs).toEqual(readGroveCronRefs("worker-two", { env: current.env }));
  });

  it("converges concurrent installs through the declaration key", async () => {
    const current = await fixture();
    const jobs = new Map<string, { id: string; declarationKey: string }>();
    const add = vi.fn(async (input: Record<string, unknown>) => {
      await Promise.resolve();
      const declarationKey = String(input.declarationKey);
      const existing = jobs.get(declarationKey);
      if (existing) {
        return { created: false, job: existing };
      }
      const created = { id: "scheduler-converged", declarationKey };
      jobs.set(declarationKey, created);
      return { created: true, job: created };
    });

    const [first, second] = await Promise.all([
      installGroveCronJobs(current.plan, { env: current.env, gateway: { add } }),
      installGroveCronJobs(current.plan, { env: current.env, gateway: { add } }),
    ]);

    expect(jobs.size).toBe(1);
    expect(first[0]).toMatchObject({ schedulerJobId: "scheduler-converged", status: "complete" });
    expect(second[0]).toMatchObject({ schedulerJobId: "scheduler-converged", status: "complete" });
  });

  it("retains creation time across replacement and scopes removal to the owning agent", async () => {
    const current = await fixture();
    const options = { env: current.env };
    const [original] = await installGroveCronJobs(current.plan, {
      ...options,
      gateway: { add: async () => ({ id: "scheduler-original" }) },
      nowMs: 42,
    });
    const replacement = {
      ...original!,
      schedulerJobId: "scheduler-replacement",
      job: { ...original!.job, message: 'Report "quoted" \\ 日本語\n\u0000' },
      error: "previous failure",
      createdAtMs: 999,
      updatedAtMs: 100,
    };
    upsertGroveCronRef(replacement, options);
    const otherAgent = {
      ...original!,
      agentId: "other-agent",
      declarationKey: "grove:other-agent:daily-report",
      schedulerJobId: "scheduler-other",
    };
    upsertGroveCronRef(otherAgent, options);
    expect(readGroveCronRefs("worker-two", options)).toEqual([{ ...replacement, createdAtMs: 42 }]);

    const removed = markGroveCronRefRemoved("worker-two", "daily-report", {
      ...options,
      nowMs: 200,
    });
    expect(removed).toMatchObject({ status: "removed", createdAtMs: 42, updatedAtMs: 200 });
    expect(removed).not.toHaveProperty("schedulerJobId");
    expect(removed).not.toHaveProperty("error");
    expect(readGroveCronRefs("worker-two", options)).toEqual([removed]);
    expect(markGroveCronRefRemoved("worker-two", "missing", options)).toBeUndefined();
    deleteGroveCronRef("worker-two", "daily-report", options);
    deleteGroveCronRef("worker-two", "daily-report", options);
    expect(readGroveCronRefs("worker-two", options)).toEqual([]);
    expect(readGroveCronRefs("other-agent", options)).toEqual([otherAgent]);
  });

  it("parses the full agent list before removal while installation reads only its declaration", async () => {
    const current = await fixture();
    const options = { env: current.env };
    const gateway = { add: vi.fn().mockResolvedValue({ id: "scheduler-valid" }) };
    const [original] = await installGroveCronJobs(current.plan, { ...options, gateway });
    upsertGroveCronRef(
      {
        ...original!,
        manifestId: "zz-malformed",
        declarationKey: "grove:worker-two:zz-malformed",
        schedulerJobId: "scheduler-malformed",
      },
      options,
    );
    const db = openBranchStateDatabase(options).db;
    db.prepare("UPDATE grove_cron_refs SET job_json = ? WHERE manifest_id = ?").run(
      "{",
      "zz-malformed",
    );

    expect(() => readGroveCronRefs("worker-two", options)).toThrow(SyntaxError);
    expect(() => markGroveCronRefRemoved("worker-two", "daily-report", options)).toThrow(
      SyntaxError,
    );
    expect(() => markGroveCronRefRemoved("worker-two", "missing", options)).toThrow(SyntaxError);
    await expect(installGroveCronJobs(current.plan, { ...options, gateway })).resolves.toEqual([
      original,
    ]);
    expect(gateway.add).toHaveBeenCalledOnce();
  });
});
