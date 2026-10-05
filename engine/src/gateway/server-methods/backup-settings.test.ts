// Branch Settings › Backups: backup.schedule.set / backup.schedule.clear / backup.run against a real
// cron store and a real folder destination.
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CronService } from "../../cron/service.js";
import { createCronStoreHarness, createNoopLogger } from "../../cron/service.test-harness.js";
import { createTestGatewayScheduler } from "../../test-utils/gateway-scheduler-clock.js";
import { createTempHomeEnv, type TempHomeEnv } from "../../test-utils/temp-home.js";
import { authorizeOperatorScopesForMethod } from "../method-scopes.js";
import { createDirectChatContext } from "../server-chat.agent-events.test-helpers.js";
import { backupHandlers } from "./backup.js";
import type { RespondFn } from "./types.js";

vi.mock("../../plugins/active-runtime-registry.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../plugins/active-runtime-registry.js")>()),
  getLoadedRuntimePluginRegistry: () => undefined,
}));

const { makeStorePath } = createCronStoreHarness({ prefix: "backup-settings-" });
let home: TempHomeEnv;
let cron: CronService;

beforeEach(async () => {
  home = await createTempHomeEnv("backup-settings-");
  const { storePath } = await makeStorePath();
  cron = new CronService({
    scheduler: createTestGatewayScheduler(),
    storePath,
    cronEnabled: false,
    defaultAgentId: "main",
    log: createNoopLogger(),
    enqueueSystemEvent: vi.fn(),
    requestHeartbeat: vi.fn(),
    runIsolatedAgentJob: vi.fn(async () => ({ status: "ok" as const })),
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await home.restore();
});

async function call(method: string, params: Record<string, unknown>) {
  const handler = backupHandlers[method];
  if (!handler) {
    throw new Error(`Missing ${method} handler`);
  }
  const respond = vi.fn<RespondFn>();
  await handler({
    req: { type: "req", id: method, method },
    params,
    context: createDirectChatContext({ cron, getRuntimeConfig: () => ({}) }),
    client: null,
    isWebchatConnect: () => false,
    respond,
  });
  const [ok, payload, error] = respond.mock.calls[0] ?? [];
  return { ok, payload: payload as Record<string, unknown>, error };
}

describe("Settings › Backups gateway methods", () => {
  it("saves a folder destination as a secret-free Git schedule, turns it off and on, then clears it", async () => {
    const folder = path.join(home.home, "Backups", "branch");
    const set = await call("backup.schedule.set", {
      destination: { kind: "folder", path: folder },
      everyMs: 86_400_000,
      enabled: false,
    });
    expect(set.ok).toBe(true);
    expect(set.payload).toMatchObject({ repository: folder, push: false, enabled: false });
    expect(execFileSync("git", ["-C", folder, "rev-parse", "--is-inside-work-tree"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim()).toBe("true");
    const [job] = await cron.list({ includeDisabled: true });
    expect(job?.payload).toMatchObject({
      kind: "command",
      argv: ["branch", "backup", "git", "create", "--repository", folder, "--all", "--exclude-secrets", "--files"],
    });

    const weekly = await call("backup.schedule.set", {
      destination: { kind: "folder", path: folder },
      everyMs: 604_800_000,
      enabled: true,
    });
    expect(weekly.payload).toMatchObject({ id: job?.id, enabled: true, everyMs: 604_800_000 });
    const status = await call("backup.status", {});
    expect(status.payload.schedules).toEqual([
      expect.objectContaining({
        mode: "git",
        target: folder,
        enabled: true,
        everyMs: 604_800_000,
        push: false,
        excludeSecrets: true,
        files: true,
      }),
    ]);

    expect((await call("backup.schedule.clear", {})).payload).toEqual({ removed: true });
    expect(await cron.list({ includeDisabled: true })).toEqual([]);
  });

  it("rejects a repository address that carries a sign-in, before writing anything", async () => {
    const set = await call("backup.schedule.set", {
      destination: { kind: "git", url: "https://someone:ghp_example@github.com/KeepOak/x.git" },
      everyMs: 86_400_000,
      enabled: true,
    });
    expect(set.ok).toBe(false);
    expect(String((set.error as { message?: string }).message)).toContain("Leave the sign-in out");
    expect(await cron.list({ includeDisabled: true })).toEqual([]);
  });

  it("starts a Git destination on the backups branch and reports where it pushes", async () => {
    const remote = path.join(`${home.home}-remote.git`);
    execFileSync("git", ["init", "--bare", remote], { windowsHide: true });
    const set = await call("backup.schedule.set", {
      destination: { kind: "git", url: remote },
      everyMs: 86_400_000,
      enabled: true,
    });
    expect(set.ok).toBe(true);
    expect(set.payload).toMatchObject({ push: true });
    const repository = String(set.payload.repository);
    expect(
      execFileSync("git", ["-C", repository, "symbolic-ref", "HEAD"], {
        encoding: "utf8",
        windowsHide: true,
      }).trim(),
    ).toBe("refs/heads/backups");
    const status = await call("backup.status", {});
    expect(status.payload.schedules).toEqual([expect.objectContaining({ push: true, remote })]);
    await fs.rm(remote, { recursive: true, force: true });
  });

  it("Back up now runs the stored schedule through cron, and asks for a destination first", async () => {
    const none = await call("backup.run", {});
    expect(none.ok).toBe(false);
    expect(String((none.error as { message?: string }).message)).toContain(
      "Choose where backups go first",
    );
    await call("backup.schedule.set", {
      destination: { kind: "folder", path: path.join(home.home, "Backups") },
      everyMs: 86_400_000,
      enabled: false,
    });
    const [job] = await cron.list({ includeDisabled: true });
    const enqueue = vi
      .spyOn(cron, "enqueueRun")
      .mockResolvedValue({ ok: true, enqueued: true, runId: "run-1" });
    const run = await call("backup.run", {});
    expect(enqueue).toHaveBeenCalledWith(job?.id, "force");
    expect(run.payload).toEqual({ jobId: job?.id, started: true });
  });

  it("needs operator admin scope to change or run backups", () => {
    for (const method of ["backup.schedule.set", "backup.schedule.clear", "backup.run"]) {
      expect(authorizeOperatorScopesForMethod(method, ["operator.read"])).toMatchObject({
        allowed: false,
      });
      expect(authorizeOperatorScopesForMethod(method, ["operator.admin"])).toEqual({
        allowed: true,
      });
    }
  });
});
