import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import * as cronAuthority from "../cron/store/receipt-authority-owner.js";
import { acquireGatewayLock } from "../infra/gateway-lock.js";
import { captureGatewayStateOwner } from "../infra/gateway-state-owner.js";
import { enqueueCommandInLane } from "../process/command-queue.js";
import {
  isGatewayWorkAdmissionClosed,
  resetGatewayWorkAdmission,
} from "../process/gateway-work-admission.js";
import {
  listSessionHandoffLeases,
  resolveSessionHandoffLeaseDir,
} from "../process/session-handoff-lease-files.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { createBranchTestState } from "../test-utils/branch-test-state.js";
import { getFreePort } from "../test-utils/ports.js";
import { prepareGatewayKernel } from "./server-kernel.js";
import { GatewayHandoffFatalError } from "./server-handoff-error.js";
import * as runShutdown from "./server-run-shutdown.js";
import * as stateRuntime from "./server-runtime-state-prepare.js";
import { startGatewayServerCore } from "./server-start.js";
import { startGatewayServer } from "./server.js";

async function withPhaseState<T>(label: string, run: (port: number) => Promise<T>): Promise<T> {
  const port = await getFreePort();
  const state = await createBranchTestState({
    label,
    layout: "home",
    env: {
      BRANCH_GATEWAY_PASSWORD: undefined,
      BRANCH_GATEWAY_TOKEN: undefined,
      BRANCH_SKIP_BROWSER_CONTROL_SERVER: "1",
      BRANCH_SKIP_CANVAS_HOST: "1",
      BRANCH_SKIP_CHANNELS: "1",
      BRANCH_SKIP_CRON: "1",
      BRANCH_SKIP_GMAIL_WATCHER: "1",
      BRANCH_SKIP_PROVIDERS: "1",
      BRANCH_TEST_MINIMAL_GATEWAY: "1",
      VITEST: "1",
    },
  });
  try {
    await state.writeConfig({
      gateway: { auth: { mode: "token", token: `${label}-token` }, port },
      agents: { defaults: { model: "unit-test/model", utilityModel: "" } },
    });
    state.applyEnv();
    return await run(port);
  } finally {
    vi.restoreAllMocks();
    resetGatewayWorkAdmission();
    await state.cleanup();
  }
}

const options = (token: string) => ({
  auth: { mode: "token" as const, token },
  bind: "loopback" as const,
  controlUiEnabled: false,
  sidecarStartup: "defer" as const,
});

describe("Gateway startup phases", () => {
  it("prepare does not evaluate plugin code or write state", async () => {
    await withPhaseState("gateway-phase-plugin-prepare", async (port) => {
      const directory = mkdtempSync(path.join(tmpdir(), "gateway-phase-plugin-"));
      try {
        const modulePath = path.join(directory, "index.cjs");
        const loadedPath = path.join(directory, "loaded");
        const registeredPath = path.join(directory, "registered");
        writeFileSync(
          path.join(directory, "branch.plugin.json"),
          JSON.stringify({
            id: "phase-probe",
            channels: ["phase-probe"],
            configSchema: { type: "object" },
          }),
        );
        writeFileSync(
          modulePath,
          `require('node:fs').writeFileSync(${JSON.stringify(loadedPath)}, 'loaded');
           module.exports = { id: 'phase-probe', register() {
             require('node:fs').writeFileSync(${JSON.stringify(registeredPath)}, 'registered');
           } };`,
        );
        const { writeConfigFile } = await import("../config/config.js");
        await writeConfigFile({
          gateway: { auth: { mode: "token", token: "gateway-phase-plugin-prepare-token" }, port },
          agents: { defaults: { model: "unit-test/model", utilityModel: "" } },
          plugins: {
            allow: ["phase-probe"],
            entries: { "phase-probe": { enabled: true } },
            load: { paths: [modulePath] },
          },
        });
        const statePath = resolveBranchStateSqlitePath();
        const existedBefore = existsSync(statePath);
        const observer = existedBefore
          ? new DatabaseSync(statePath, { readOnly: true })
          : undefined;
        try {
          // SQLite may checkpoint an existing WAL into the main file while a read-only
          // preparation runs. data_version detects committed writes without mistaking
          // that physical file rewrite for a state mutation.
          const before = observer?.prepare("PRAGMA data_version").get();
          await prepareGatewayKernel(port, options("gateway-phase-plugin-prepare-token"));
          expect(existsSync(loadedPath)).toBe(false);
          expect(existsSync(registeredPath)).toBe(false);
          expect(existsSync(statePath)).toBe(existedBefore);
          expect(observer?.prepare("PRAGMA data_version").get()).toEqual(before);
        } finally {
          observer?.close();
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  });

  it("prepare does not write the state database", async () => {
    await withPhaseState("gateway-phase-prepare", async (port) => {
      const path = resolveBranchStateSqlitePath();
      const before = existsSync(path) ? readFileSync(path) : undefined;
      const prepared = await prepareGatewayKernel(port, options("gateway-phase-prepare-token"));
      expect(prepared.activate).toBeTypeOf("function");
      expect(existsSync(path) ? readFileSync(path) : undefined).toEqual(before);
    });
  });

  it("activate starts cron authority only after state bootstrap", async () => {
    await withPhaseState("gateway-phase-activate", async (port) => {
      const events: string[] = [];
      const prepareState = stateRuntime.prepareGatewayKernelState;
      const startCron = cronAuthority.startCronReceiptAuthorityHost;
      vi.spyOn(stateRuntime, "prepareGatewayKernelState").mockImplementation(async (params) => {
        const state = await prepareState(params);
        events.push("state bootstrap");
        return state;
      });
      vi.spyOn(cronAuthority, "startCronReceiptAuthorityHost").mockImplementation(() => {
        events.push("cron authority");
        return startCron();
      });
      const server = await startGatewayServerCore(port, options("gateway-phase-activate-token"));
      try {
        await server.startupSettled;
        expect(events).toEqual(["state bootstrap", "cron authority"]);
      } finally {
        await server.close({ reason: "phase test cleanup" });
      }
    });
  });

  it("activates a prepared kernel at most once under concurrent callers", async () => {
    await withPhaseState("gateway-phase-concurrent-activate", async (port) => {
      const prepared = await prepareGatewayKernel(
        port,
        options("gateway-phase-concurrent-activate-token"),
      );
      const attempts = await Promise.allSettled([prepared.activate(), prepared.activate()]);
      const fulfilled = attempts.filter((result) => result.status === "fulfilled");
      const rejected = attempts.filter((result) => result.status === "rejected");
      try {
        expect(fulfilled).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect((rejected[0] as PromiseRejectedResult).reason.message).toContain(
          "Prepared Gateway kernel has already been activated",
        );
      } finally {
        await (
          fulfilled[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof prepared.activate>>>
        )?.value.closeOnStartupFailure();
      }
    });
  });

  it("restores service admission and permits retry after a failed handoff", async () => {
    await withPhaseState("gateway-phase-deactivate-retry", async (port) => {
      const server = await startGatewayServerCore(
        port,
        options("gateway-phase-deactivate-retry-token"),
      );
      try {
        vi.spyOn(cronAuthority, "drainCronReceiptAuthority").mockRejectedValueOnce(
          new Error("receipt drain failed"),
        );
        await expect(server.deactivate()).rejects.toThrow("receipt drain failed");
        expect(isGatewayWorkAdmissionClosed()).toBe(false);
        await expect(server.deactivate()).resolves.toBeUndefined();
      } finally {
        await server.close({ reason: "failed handoff retry test cleanup" });
      }
    });
  });

  it("keeps admission fenced when handoff restoration fails", async () => {
    await withPhaseState("gateway-phase-restore-fails", async (port) => {
      const server = await startGatewayServerCore(port, options("gateway-phase-restore-fails-token"));
      try {
        await server.startupSettled;
        vi.spyOn(cronAuthority, "drainCronReceiptAuthority").mockRejectedValueOnce(
          new Error("receipt drain failed"),
        );
        vi.spyOn(cronAuthority, "resumeCronReceiptAuthorityHostAfterFailedHandoff")
          .mockRejectedValueOnce(new Error("receipt restore failed"));
        await expect(server.deactivate()).rejects.toBeInstanceOf(GatewayHandoffFatalError);
        expect(isGatewayWorkAdmissionClosed()).toBe(true);
      } finally {
        await server.close({ reason: "failed restoration test cleanup" });
      }
    });
  });

  it("restores the only kernel when state lease release fails", async () => {
    await withPhaseState("gateway-phase-release-fails", async (port) => {
      let releases = 0;
      const server = await startGatewayServerCore(port, {
        ...options("gateway-phase-release-fails-token"),
        gatewayStateOwner: {
          assertDatabaseAccess: () => {},
          release: async () => {
            if (++releases === 1) throw new Error("state release failed");
          },
        },
      });
      try {
        await server.startupSettled;
        await expect(server.deactivate()).rejects.toThrow("state release failed");
        expect(isGatewayWorkAdmissionClosed()).toBe(false);
        await expect(server.deactivate()).resolves.toBeUndefined();
      } finally {
        await server.close({ reason: "failed state release test cleanup" });
      }
    });
  });

  it("keeps the kernel fenced when state release also loses database access", async () => {
    await withPhaseState("gateway-phase-release-lost", async (port) => {
      let ownsState = true;
      const server = await startGatewayServerCore(port, {
        ...options("gateway-phase-release-lost-token"),
        gatewayStateOwner: {
          assertDatabaseAccess: () => {
            if (!ownsState) throw new Error("state access lost");
          },
          release: async () => {
            ownsState = false;
            throw new Error("state release failed");
          },
        },
      });
      try {
        await server.startupSettled;
        await expect(server.deactivate()).rejects.toBeInstanceOf(GatewayHandoffFatalError);
        expect(isGatewayWorkAdmissionClosed()).toBe(true);
      } finally {
        await server.close({ reason: "lost state release test cleanup" });
      }
    });
  });

  it("deactivate releases without aborting admitted runs or closing the HTTP server", async () => {
    await withPhaseState("gateway-phase-deactivate", async (port) => {
      const events: string[] = [];
      const checkpoint = vi.spyOn(runShutdown, "prepareGatewayRunShutdown");
      const server = await startGatewayServerCore(port, {
        ...options("gateway-phase-deactivate-token"),
        gatewayStateOwner: {
          assertDatabaseAccess: () => {},
          release: async () => {
            events.push("release");
          },
        },
      });
      try {
        await server.deactivate();
        expect(checkpoint).not.toHaveBeenCalled();
        expect(events).toEqual(["release"]);
        expect(isGatewayWorkAdmissionClosed()).toBe(true);
        await server.waitForDeactivatedRuns();
        const response = await fetch(`http://127.0.0.1:${port}/healthz`);
        expect(response.status).toBe(200);
        await server.rollbackDeactivation();
        expect(isGatewayWorkAdmissionClosed()).toBe(true);
      } finally {
        await server.close({ reason: "phase test cleanup" });
      }
    });
  });

  it("retains a running session lane through handoff until its work settles", async () => {
    await withPhaseState("gateway-phase-live-run", async (port) => {
      const server = await startGatewayServerCore(port, options("gateway-phase-live-run-token"));
      const lane = "session:agent:main:phase-live-run";
      let finish!: () => void;
      const finishing = new Promise<void>((resolve) => {
        finish = resolve;
      });
      let entered!: () => void;
      const running = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const run = enqueueCommandInLane(lane, async () => {
        entered();
        await finishing;
      });
      try {
        await running;
        await server.deactivate();
        const leases = () => listSessionHandoffLeases(resolveSessionHandoffLeaseDir(), lane);
        expect(leases()).toHaveLength(1);
        finish();
        await run;
        await expect(server.waitForDeactivatedRuns()).resolves.toMatchObject({
          deadlineElapsed: false,
        });
        expect(leases()).toHaveLength(0);
      } finally {
        finish();
        await server.close({ reason: "live run handoff test cleanup" });
      }
    });
  });

  it("deliberate release of a real owner does not close the listener", async () => {
    await withPhaseState("gateway-phase-real-owner", async (port) => {
      const lock = await acquireGatewayLock({
        port,
        listenerMode: "foreground",
        allowInTests: true,
      });
      expect(lock).not.toBeNull();
      const lostOwnerRecovery = vi.fn(() => ({ status: "emitted" as const }));
      const server = await startGatewayServer(port, {
        ...options("gateway-phase-real-owner-token"),
        gatewayStateOwner: lock!,
        hotReloadRecovery: lostOwnerRecovery,
      });
      try {
        const ownerSignal = captureGatewayStateOwner(resolveBranchStateSqlitePath())?.signal;
        expect(ownerSignal).toBeDefined();
        await server.deactivate();
        expect(() => lock?.assertDatabaseAccess(resolveBranchStateSqlitePath())).toThrow();
        ownerSignal?.dispatchEvent(new Event("abort"));
        expect(lostOwnerRecovery).not.toHaveBeenCalled();
        expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
      } finally {
        await server.close({ reason: "phase test cleanup" });
        await lock?.release();
      }
    });
  });
});
