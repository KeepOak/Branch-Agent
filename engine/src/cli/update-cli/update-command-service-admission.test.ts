import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { ServiceInspectionError } from "../../daemon/service-inspection-error.js";
import * as service from "../../daemon/service.js";
import {
  createMockGatewayService,
  mockSystemAccountHome,
} from "../../daemon/service.test-helpers.js";
import { writePackageRoot } from "../../infra/package-update-steps.test-support.js";
import { createRetainedUpdateRecovery } from "../../infra/update-retained-recovery.test-support.js";
import { createUpdateRun } from "../../infra/update-run-ledger.js";
import {
  loadUpdateRecovery,
  UpdateRecoveryRequiredError,
} from "../../infra/update-run-recovery.js";
import { defaultRuntime, ExitError } from "../../runtime.js";
import { closeBranchStateDatabaseForTest } from "../../state/branch-state-db.js";
import { withEnvAsync } from "../../test-utils/env.js";
import { mockProcessPlatform } from "../../test-utils/vitest-spies.js";
import * as shared from "./shared.js";
import {
  admitUpdateCommandRun,
  prepareUpdateCommand,
  resolveUpdateCommandAdmissionEnv,
  resolveUpdateCommandAdmissionRoot,
} from "./update-command-run.js";
import { maybeStopManagedServiceBeforeMutableUpdate } from "./update-command-service-maintenance.js";
import { GatewayServiceUpdateOwnershipError } from "./update-command-service-plan.js";
import { updateCommand } from "./update-command.js";

const dirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => {
  closeBranchStateDatabaseForTest();
  vi.restoreAllMocks();
});

it.each([
  { platform: "linux", outcome: "unavailable" },
  { platform: "linux", outcome: "conflict" },
  { platform: "darwin", outcome: "conflict" },
  { platform: "linux", outcome: "pending" },
  { platform: "darwin", outcome: "redirect" },
] as const)(
  "preserves service admission authority ($platform, $outcome)",
  async ({ platform, outcome }) => {
    const home = dirs.make("update-service-admission-");
    const callerRoot = path.join(home, "caller-package");
    const serviceRoot = path.join(home, "service-package");
    const callerState = path.join(home, ".branch-caller");
    const serviceState = path.join(home, ".branch-service");
    await Promise.all([
      writePackageRoot(callerRoot, "1.0.0"),
      writePackageRoot(serviceRoot, "1.0.0"),
    ]);
    await withEnvAsync(
      {
        HOME: home,
        BRANCH_HOME: undefined,
        BRANCH_PROFILE: "caller",
        BRANCH_STATE_DIR: callerState,
        BRANCH_CONFIG_PATH: path.join(callerState, "branch.json"),
        BRANCH_SYSTEMD_UNIT: undefined,
        BRANCH_LAUNCHD_LABEL: undefined,
        BRANCH_WINDOWS_TASK_NAME: undefined,
        BRANCH_SUPERVISOR_MODE: undefined,
        BRANCH_UPDATE_RUN_ID: undefined,
        BRANCH_UPDATE_POST_CORE: undefined,
      },
      async () => {
        mockProcessPlatform(platform);
        mockSystemAccountHome();
        vi.spyOn(shared, "resolveUpdateRoot").mockResolvedValue(callerRoot);
        const native = createMockGatewayService({
          isLoaded: async () => {
            if (outcome === "unavailable") {
              throw new ServiceInspectionError("service-manager-unavailable");
            }
            return true;
          },
          readRuntime: async () =>
            outcome === "unavailable"
              ? { status: "unknown", inspectionReason: "service-manager-unavailable" }
              : { status: "running", systemd: { managerUid: 2001 } },
          readCommand: async () => ({
            programArguments: [
              process.execPath,
              path.join(serviceRoot, "dist", "index.js"),
              "gateway",
            ],
            environment: {
              BRANCH_PROFILE: "service",
              BRANCH_STATE_DIR: serviceState,
              BRANCH_CONFIG_PATH: path.join(serviceState, "branch.json"),
              ...(outcome === "conflict"
                ? platform === "linux"
                  ? { BRANCH_SYSTEMD_UNIT: "branch-gateway-other.service" }
                  : { BRANCH_LAUNCHD_LABEL: "ai.branch.other" }
                : {}),
            },
          }),
        });
        vi.spyOn(service, "resolveGatewayService").mockReturnValue(native);
        if (outcome === "conflict") {
          await expect(prepareUpdateCommand({ dryRun: true })).rejects.toBeInstanceOf(
            GatewayServiceUpdateOwnershipError,
          );
          const temporaryRoot = path.join(home, "reports");
          await fs.mkdir(temporaryRoot);
          vi.spyOn(os, "tmpdir").mockReturnValue(temporaryRoot);
          const output = vi.spyOn(defaultRuntime, "writeJson").mockImplementation(() => {});
          vi.spyOn(defaultRuntime, "error").mockImplementation(() => {});
          const exit = await updateCommand({ dryRun: true, json: true }).catch(
            (error: unknown) => error,
          );
          expect(exit).toBeInstanceOf(ExitError);
          expect(exit).toMatchObject({ code: 1 });
          expect(output).toHaveBeenCalledExactlyOnceWith(
            expect.objectContaining({
              status: "error",
              reason: "managed-service-preflight",
              reportPath: expect.any(String),
            }),
          );
          const { reportPath } = output.mock.calls[0]![0] as { reportPath: string };
          expect(path.dirname(path.dirname(reportPath))).toBe(temporaryRoot);
          expect(await fs.readFile(reportPath, "utf8")).toContain("Bounded diagnostic JSON:");
          await expect(fs.stat(callerState)).rejects.toMatchObject({ code: "ENOENT" });
          await expect(fs.stat(serviceState)).rejects.toMatchObject({ code: "ENOENT" });
          expect(native.stop).not.toHaveBeenCalled();
          expect(native.install).not.toHaveBeenCalled();
          return;
        }
        const prepared = await prepareUpdateCommand({ dryRun: true });
        const root = resolveUpdateCommandAdmissionRoot(prepared);
        expect(prepared.discoveredRoot).toBe(callerRoot);
        expect(prepared.servicePlan?.rootRedirect).toBeNull();
        expect(prepared.servicePlan?.serviceRoot).toBe(
          outcome === "unavailable" ? undefined : serviceRoot,
        );
        const env = await resolveUpdateCommandAdmissionEnv({ root, opts: {} });
        expect(root).toBe(outcome === "unavailable" ? callerRoot : serviceRoot);
        expect(env.BRANCH_STATE_DIR).toBe(outcome === "unavailable" ? callerState : serviceState);
        if (outcome === "pending") {
          const runId = createUpdateRun({ trigger: "cli" }, { env }).runId;
          const from = { root, nodePath: process.execPath, version: "1.0.0", buildId: null };
          const retained = createRetainedUpdateRecovery(
            { runId, from, to: { ...from, version: "2.0.0" } },
            { env },
          );
          closeBranchStateDatabaseForTest();
          await expect(admitUpdateCommandRun({ opts: {}, root })).rejects.toBeInstanceOf(
            UpdateRecoveryRequiredError,
          );
          expect(loadUpdateRecovery(runId, { env })).toEqual(retained);
          await expect(fs.stat(callerState)).rejects.toMatchObject({ code: "ENOENT" });
        } else {
          const run = await admitUpdateCommandRun({ opts: {}, root });
          expect(run.env.BRANCH_STATE_DIR).toBe(env.BRANCH_STATE_DIR);
          if (outcome === "unavailable") {
            const inspected = await maybeStopManagedServiceBeforeMutableUpdate({
              root,
              updateInstallKind: "package",
              shouldRestart: true,
              phase: "inspect",
              jsonMode: true,
            });
            expect(inspected.serviceUpdateVerdict).toMatchObject({
              kind: "unavailable",
              inspectionReason: "service-manager-unavailable",
              message: expect.stringContaining("Restart the Gateway you launched manually"),
            });
            expect(inspected.blockMessage).toBeUndefined();
            expect(inspected.serviceEnv).toBeUndefined();
            await expect(fs.stat(serviceState)).rejects.toMatchObject({ code: "ENOENT" });
          }
        }
        expect(native.stop).not.toHaveBeenCalled();
        expect(native.install).not.toHaveBeenCalled();
      },
    );
  },
);
