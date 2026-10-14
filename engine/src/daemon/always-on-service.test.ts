// Private #454 A: the desktop app's engine runs as a per-user service built only by engine/src/daemon.
// Pure definitions for all three OSes from the same install plan the app's `branch gateway install` uses.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { buildGatewayInstallPlan } from "../commands/daemon-install-helpers.js";
import { buildLaunchAgentPlist } from "./launchd-plist.js";
import {
  countGatewayServiceStarts,
  GATEWAY_CRASH_STORM_EXIT_CODE,
  GATEWAY_CRASH_STORM_THRESHOLD,
  GATEWAY_CRASH_STORM_WINDOW_MS,
  guardGatewayCrashStorm,
  resolveGatewayCrashStormMarkerPath,
} from "./restart-storm.js";
import { buildTaskScript } from "./schtasks-layout.js";
import { buildScheduledTaskXml } from "./schtasks-xml.js";
import { buildSystemdUnit, SYSTEMD_FIXED_POLICY } from "./systemd-unit.js";

const DATA = "/data/BranchAgent";
const desktopEnv = {
  HOME: "/home/owner",
  USERPROFILE: "/home/owner",
  BRANCH_PROFILE: "default",
  BRANCH_HOME: `${DATA}/home`,
  BRANCH_STATE_DIR: `${DATA}/home/.branch`,
  BRANCH_CONFIG_PATH: `${DATA}/home/.branch/branch.json`,
};
// The published engine copy the app runs (a built CLI is all the planner checks for).
const engineDir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-engine-"));
fs.mkdirSync(path.join(engineDir, "dist"));
fs.writeFileSync(path.join(engineDir, "dist", "index.js"), "");
const serviceCli = {
  executable: "/app/node/bin/node",
  entrypoint: path.join(engineDir, "dist", "index.js"),
};
afterAll(() => fs.rmSync(engineDir, { recursive: true, force: true }));

async function plan(platform: NodeJS.Platform) {
  return buildGatewayInstallPlan({
    env: desktopEnv,
    port: 19031,
    runtime: "node",
    platform,
    serviceCli,
  });
}

describe("always-on service definitions (engine/src/daemon)", () => {
  it("macOS: a per-user LaunchAgent that starts at sign-in, restarts with launchd's throttle and keeps the app's home", async () => {
    const { programArguments, workingDirectory, environment } = await plan("darwin");
    expect(programArguments.slice(-3)).toEqual(["gateway", "--port", "19031"]);
    expect(programArguments).toContain(serviceCli.entrypoint);
    expect(environment.BRANCH_HOME).toBe(desktopEnv.BRANCH_HOME);
    expect(environment.BRANCH_STATE_DIR).toBe(desktopEnv.BRANCH_STATE_DIR);
    expect(environment.BRANCH_SERVICE_KIND).toBe("gateway");
    const plist = buildLaunchAgentPlist({
      label: environment.BRANCH_LAUNCHD_LABEL ?? "",
      programArguments,
      workingDirectory,
      stdoutPath: "/home/owner/Library/Logs/branch/gateway.log",
      stderrPath: "/home/owner/Library/Logs/branch/gateway.err.log",
      environment,
    });
    expect(plist).toContain("<key>Label</key>\n    <string>ai.branch.gateway</string>");
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/);
    expect(plist).toMatch(/<key>ThrottleInterval<\/key>\s*<integer>10<\/integer>/);
    expect(plist).toMatch(
      new RegExp(`<key>BRANCH_HOME</key>\\s*<string>${desktopEnv.BRANCH_HOME}</string>`),
    );
    // A LaunchAgent runs as the signed-in user: no root-only keys.
    expect(plist).not.toContain("UserName");
  });

  it("Linux: a systemd --user unit with bounded restart backoff that stops on the storm exit status", async () => {
    const { programArguments, workingDirectory, environment } = await plan("linux");
    const unit = buildSystemdUnit({
      description: "Branch Agent Gateway",
      programArguments,
      workingDirectory,
      environment,
    });
    expect(unit).toContain(`ExecStart=${programArguments.join(" ")}`);
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("RestartSec=5");
    expect(unit).toContain("StartLimitBurst=10");
    expect(unit).toContain(`RestartPreventExitStatus=${GATEWAY_CRASH_STORM_EXIT_CODE}`);
    expect(SYSTEMD_FIXED_POLICY["Service.RestartPreventExitStatus"]).toBe(
      String(GATEWAY_CRASH_STORM_EXIT_CODE),
    );
    // default.target is the per-user manager's target; a system unit would want multi-user.target.
    expect(unit).toContain("WantedBy=default.target");
    expect(unit).not.toMatch(/^User=/m);
    expect(unit).toContain(`Environment=BRANCH_HOME=${desktopEnv.BRANCH_HOME}`);
  });

  it("Windows: a least-privilege logon Scheduled Task whose script runs the gateway outside any app process", async () => {
    const { programArguments, workingDirectory, environment } = await plan("win32");
    const script = buildTaskScript({
      description: "Branch Agent Gateway",
      programArguments,
      workingDirectory,
      environment,
    });
    expect(script).toContain(`set "BRANCH_HOME=${desktopEnv.BRANCH_HOME}"`);
    expect(script).toMatch(/ gateway --port 19031 --task-supervisor < NUL\r\n$/);
    const xml = buildScheduledTaskXml({
      taskDescription: "Branch Agent Gateway",
      taskUser: "PC\\owner",
      launchPath: "C:\\Users\\owner\\.branch\\gateway.cmd",
    });
    expect(xml).toContain("<LogonTrigger>");
    expect(xml).toContain("<UserId>PC\\owner</UserId>");
    // No admin prompt: the task runs with the user's own limited token.
    expect(xml).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(xml).not.toContain("HighestAvailable");
    expect(xml).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
    expect(xml).toMatch(/<RestartOnFailure>\s*<Interval>PT1M<\/Interval>\s*<Count>3<\/Count>/);
  });
});

describe("crash storm guard", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  const stateEnv = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "branch-storm-"));
    dirs.push(dir);
    return { HOME: dir, BRANCH_STATE_DIR: path.join(dir, ".branch") };
  };

  it("lets four starts in a minute through and stops the service on the fifth, once, with a plain repair", async () => {
    const env = stateEnv();
    const stopService = vi.fn(async () => undefined);
    const now = Date.parse("2026-10-14T00:00:00.000Z");
    for (let i = 0; i < GATEWAY_CRASH_STORM_THRESHOLD - 1; i++) {
      expect(
        await guardGatewayCrashStorm(env, {
          stopService,
          platform: "darwin",
          now: now + i * 1_000,
        }),
      ).toBeUndefined();
    }
    expect(fs.existsSync(resolveGatewayCrashStormMarkerPath(env))).toBe(false);
    const storm = await guardGatewayCrashStorm(env, {
      stopService,
      platform: "darwin",
      now: now + 5_000,
    });
    expect(storm?.starts).toBe(GATEWAY_CRASH_STORM_THRESHOLD);
    expect(storm?.message).toContain("branch doctor --fix");
    expect(stopService).toHaveBeenCalledTimes(1);
    const marker = JSON.parse(fs.readFileSync(resolveGatewayCrashStormMarkerPath(env), "utf8"));
    expect(marker.message).toBe(storm?.message);
  });

  it("does not count starts older than the window", async () => {
    const env = stateEnv();
    const stopService = vi.fn(async () => undefined);
    const now = Date.parse("2026-10-14T00:00:00.000Z");
    for (let i = 0; i < GATEWAY_CRASH_STORM_THRESHOLD; i++) {
      await guardGatewayCrashStorm(env, {
        stopService,
        platform: "darwin",
        now: now + i * GATEWAY_CRASH_STORM_WINDOW_MS,
      });
    }
    expect(countGatewayServiceStarts(env, now + 4 * GATEWAY_CRASH_STORM_WINDOW_MS)).toBe(1);
    expect(stopService).not.toHaveBeenCalled();
  });

  it("leaves systemd and Task Scheduler to their own restart limits and only exits with the storm status", async () => {
    for (const platform of ["linux", "win32"] as const) {
      const env = stateEnv();
      const stopService = vi.fn(async () => undefined);
      const now = Date.parse("2026-10-14T00:00:00.000Z");
      let storm;
      for (let i = 0; i < GATEWAY_CRASH_STORM_THRESHOLD; i++) {
        storm = await guardGatewayCrashStorm(env, { stopService, platform, now: now + i });
      }
      expect(storm?.starts).toBe(GATEWAY_CRASH_STORM_THRESHOLD);
      expect(stopService).not.toHaveBeenCalled();
    }
  });
});
