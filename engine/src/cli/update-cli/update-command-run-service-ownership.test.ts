import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../../test/helpers/temp-dir.js";
import * as daemonExec from "../../daemon/exec-file.js";
import * as gatewayService from "../../daemon/service.js";
import { createMockGatewayService } from "../../daemon/service.test-helpers.js";
import * as systemdExec from "../../daemon/systemd-exec.js";
import {
  readSystemdServiceExecStart,
  resolveSystemdUnitPath,
} from "../../daemon/systemd-service-files.js";
import { systemdManagerVersionProbe } from "../../daemon/systemd-user-bus.test-support.js";
import * as updateCheck from "../../infra/update-check.js";
import { UPDATE_RUN_ID_ENV } from "../../infra/update-control-plane-sentinel.js";
import { createRetainedUpdateRecovery } from "../../infra/update-retained-recovery.test-support.js";
import { createUpdateRun, getUpdateRun } from "../../infra/update-run-ledger.js";
import {
  loadUpdateRecovery,
  UpdateRecoveryRequiredError,
} from "../../infra/update-run-recovery.js";
import { closeBranchStateDatabaseForTest } from "../../state/branch-state-db.js";
import { collectServiceInspectionFailureFacts } from "./update-command-result.js";
import { admitUpdateCommandRun } from "./update-command-run.js";
import { stubNodeRuntime } from "./update-command-runtime-recovery.test-support.js";
import { maybeStopManagedServiceBeforeMutableUpdate } from "./update-command-service-maintenance.js";
import * as servicePlan from "./update-command-service-plan.js";

const dirs = useAutoCleanupTempDirTracker(afterEach);
afterEach(() => {
  closeBranchStateDatabaseForTest();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

it.each([
  "owned",
  "owned-pending",
  "stale-install",
  "absent",
  "unloaded-local",
  "timeout",
  "unresolved-root",
  "native-rejection",
  "root-probe-error",
] as const)(
  "preserves verified ownership and warns on unavailable inspection (%s)",
  async (scenario) => {
    stubNodeRuntime();
    const home = dirs.make("update-loaded-admission-");
    const callerState = path.join(home, ".branch-caller");
    const serviceState = path.join(home, ".branch-service");
    const root = path.join(home, "package");
    const foreignRoot = path.join(home, "foreign");
    for (const packageRoot of [root, foreignRoot]) {
      fs.mkdirSync(path.join(packageRoot, "dist"), { recursive: true });
      fs.writeFileSync(
        path.join(packageRoot, "package.json"),
        JSON.stringify({ name: "branch" }),
      );
      fs.writeFileSync(path.join(packageRoot, "dist", "entry.js"), "// fixture");
    }
    vi.spyOn(os, "userInfo").mockReturnValue({ ...os.userInfo(), homedir: home });
    for (const key of [
      "BRANCH_HOME",
      "BRANCH_SYSTEMD_UNIT",
      "BRANCH_LAUNCHD_LABEL",
      "BRANCH_WINDOWS_TASK_NAME",
      "BRANCH_SUPERVISOR_MODE",
      UPDATE_RUN_ID_ENV,
    ]) {
      vi.stubEnv(key, undefined);
    }
    vi.stubEnv("HOME", home);
    vi.stubEnv("DBUS_SESSION_BUS_ADDRESS", `unix:path=${path.join(home, "bus")}`);
    vi.spyOn(daemonExec, "execFileUtf8").mockImplementation(systemdManagerVersionProbe);
    vi.stubEnv("BRANCH_PROFILE", "caller");
    vi.stubEnv("BRANCH_STATE_DIR", callerState);
    vi.stubEnv("BRANCH_CONFIG_PATH", path.join(callerState, "branch.json"));
    const serviceEnv = {
      ...process.env,
      BRANCH_PROFILE: "service",
      BRANCH_STATE_DIR: serviceState,
      BRANCH_CONFIG_PATH: path.join(serviceState, "branch.json"),
    };
    let pending: ReturnType<typeof createRetainedUpdateRecovery> | undefined;
    if (scenario === "owned-pending") {
      const runId = createUpdateRun({ trigger: "cli" }, { env: serviceEnv }).runId;
      const from = { root, nodePath: process.execPath, version: "1.0.0", buildId: null };
      pending = createRetainedUpdateRecovery(
        { runId, from, to: { ...from, version: "2.0.0" } },
        { env: serviceEnv },
      );
      closeBranchStateDatabaseForTest();
    }
    const sourcePath = resolveSystemdUnitPath(process.env);
    if (scenario === "unloaded-local") {
      fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
      fs.writeFileSync(
        sourcePath,
        `[Service]\nExecStart=${process.execPath} ${root}/dist/entry.js gateway\n`,
      );
    }
    const snapshot = () =>
      fs
        .readdirSync(home, { recursive: true })
        .map(String)
        .toSorted()
        .map((name) => {
          const filename = path.join(home, name);
          const stat = fs.statSync(filename);
          return [
            name,
            stat.ino,
            stat.mtimeMs,
            stat.mode,
            stat.isFile()
              ? createHash("sha256").update(fs.readFileSync(filename)).digest("hex")
              : null,
          ];
        });
    const before = snapshot();
    const nativeFailure = new Error("inspection-secret-canary");
    const rootFailure = new Error("installation classification failed");
    if (scenario === "root-probe-error") {
      vi.spyOn(updateCheck, "resolveUpdateInstallKind").mockRejectedValue(rootFailure);
    }
    const command =
      scenario === "unresolved-root"
        ? ["opaque-launcher"]
        : [
            process.execPath,
            path.join(scenario === "stale-install" ? foreignRoot : root, "dist", "entry.js"),
            "gateway",
          ];
    const response = (values: { type: string; data: unknown }[]) => ({
      code: 0,
      termination: "exit" as const,
      stderr: "",
      stdout: values.map((value) => JSON.stringify(value)).join("\n"),
    });
    const bus = vi.spyOn(systemdExec, "execBusctlUser").mockImplementation(async (_env, args) => {
      if (scenario === "timeout") {
        return {
          code: 1,
          termination: "timeout",
          stdout: "",
          stderr: "inspection timed out",
        };
      }
      if (scenario === "absent" || scenario === "unloaded-local") {
        const unit = "branch-gateway-caller.service";
        return {
          code: 1,
          termination: "exit",
          stdout: "",
          stderr: args.includes("GetUnitFileState")
            ? `Call failed: Unit file ${unit} does not exist.`
            : `Call failed: Unit ${unit} ${args.includes("GetUnit") ? "not loaded" : "not found"}.`,
        };
      }
      if (args.includes("GetUnit") || args.includes("LoadUnit")) {
        return response([{ type: "o", data: ["/org/freedesktop/systemd1/unit/gateway"] }]);
      }
      if (args.includes("FragmentPath")) {
        return response([
          { type: "s", data: sourcePath },
          { type: "as", data: [] },
          { type: "b", data: false },
          { type: "s", data: "loaded" },
        ]);
      }
      return response([
        { type: "a(sasbttttuii)", data: [[command[0], command, false, 0, 0, 0, 0, 0, 0, 0]] },
        { type: "s", data: "" },
        {
          type: "as",
          data: Object.entries(serviceEnv)
            .filter(([key]) =>
              ["BRANCH_PROFILE", "BRANCH_STATE_DIR", "BRANCH_CONFIG_PATH"].includes(key),
            )
            .map(([key, value]) => `${key}=${value}`),
        },
        { type: "a(sb)", data: [] },
        { type: "as", data: [] },
      ]);
    });
    if (scenario === "native-rejection") {
      bus.mockRejectedValue(nativeFailure);
    }
    // Keep the real command reader with independently verified native runtime facts.
    const service = createMockGatewayService({
      isLoaded: async () => true,
      readRuntime: async () => ({ status: "running", systemd: { managerUid: 2001 } }),
    });
    vi.spyOn(gatewayService, "resolveGatewayService").mockReturnValue({
      ...service,
      readCommand: (...args) => readSystemdServiceExecStart(...args),
    });
    if (scenario === "owned" || scenario === "stale-install" || scenario === "absent") {
      const run = await admitUpdateCommandRun({ opts: {}, root });
      const usesServiceState = scenario !== "absent";
      const expectedState = usesServiceState ? serviceState : callerState;
      expect(run.env.BRANCH_STATE_DIR).toBe(expectedState);
      expect(run.env.BRANCH_PROFILE).toBe(usesServiceState ? "service" : "caller");
      expect(getUpdateRun(run.runId, { env: run.env })?.status).toBe("running");
      expect(fs.existsSync(path.join(usesServiceState ? callerState : serviceState, "state"))).toBe(
        false,
      );
    } else if (scenario === "owned-pending" || scenario === "root-probe-error") {
      const failure: unknown = await admitUpdateCommandRun({ opts: {}, root }).then(
        () => "admitted",
        (error: unknown) => error,
      );
      if (scenario === "owned-pending") {
        expect(failure).toBeInstanceOf(UpdateRecoveryRequiredError);
      } else if (scenario === "root-probe-error") {
        expect(failure).toBe(rootFailure);
      }
      expect(snapshot()).toEqual(before);
      if (pending) {
        expect(loadUpdateRecovery(pending.runId, { env: serviceEnv })).toEqual(pending);
      }
    } else {
      expect(await servicePlan.resolveManagedServicePackageUpdatePlan({ root })).toEqual({
        rootRedirect: null,
        serviceUnitTarget: "no service entrypoint found",
      });
      const run = await admitUpdateCommandRun({ opts: {}, root });
      expect(run.env.BRANCH_STATE_DIR).toBe(callerState);
      expect(run.env.BRANCH_CONFIG_PATH).toBe(path.join(callerState, "branch.json"));
      expect(run.env.BRANCH_PROFILE).toBe("caller");
      expect(getUpdateRun(run.runId, { env: run.env })?.status).toBe("running");
      expect(fs.existsSync(serviceState)).toBe(false);

      const inspected = await maybeStopManagedServiceBeforeMutableUpdate({
        root,
        updateInstallKind: "package",
        shouldRestart: true,
        jsonMode: true,
        phase: "inspect",
      });
      expect(inspected.serviceUpdateVerdict).toMatchObject({
        kind: "unavailable",
        message: expect.stringContaining("Gateway service inspection is unavailable"),
      });
      const advisory = inspected.serviceMutationSkipMessage;
      expect(advisory).toContain("automatic service restart was skipped");
      expect(advisory).toContain("Restart the Gateway you launched manually after the update");
      expect(advisory).toContain("recorded service definition was left unchanged");
      expect(advisory).toContain("branch gateway status --deep");
      expect(inspected.blockMessage).toBeUndefined();
      expect(inspected.serviceMutationAllowed).toBe(false);
      expect(inspected.stopped).toBe(false);
      expect(inspected.serviceEnv === undefined).toBe(true);
      expect(inspected.serviceDefinitionEnv === undefined).toBe(true);
      expect(inspected.serviceNodeRunner).toBeUndefined();
      const facts = collectServiceInspectionFailureFacts(inspected.serviceUpdateVerdict);
      expect(facts).toEqual([
        expect.objectContaining({
          check: "managed-service",
          code:
            scenario === "timeout"
              ? "systemd-inspection-deadline-exceeded"
              : "service-inspection-unavailable",
          message: expect.stringContaining(
            scenario === "timeout"
              ? "The systemd manager inspection deadline expired"
              : "Restart the Gateway you launched manually",
          ),
        }),
      ]);
      expect(JSON.stringify({ inspected, facts })).not.toContain("inspection-secret-canary");
      expect(
        snapshot().filter(
          ([name]) => name !== ".branch-caller" && !String(name).startsWith(".branch-caller/"),
        ),
      ).toEqual(before);
    }
    for (const mutation of [
      service.stage,
      service.install,
      service.uninstall,
      service.start,
      service.stop,
      service.restart,
    ]) {
      expect(mutation).not.toHaveBeenCalled();
    }
    if (scenario === "root-probe-error") {
      expect(bus).not.toHaveBeenCalled();
    } else {
      expect(bus).toHaveBeenCalled();
    }
    expect(bus.mock.calls.every(([, args]) => !args.includes("LoadUnit"))).toBe(true);
  },
);
