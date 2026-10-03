// Daemon runtime hint tests cover platform-specific daemon guidance.
import { describe, expect, it } from "vitest";
import { buildPlatformRuntimeLogHints, buildPlatformServiceStartHints } from "./runtime-hints.js";

describe("buildPlatformRuntimeLogHints", () => {
  it("renders launchd log hints on darwin", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "darwin",
        env: {
          HOME: "/Users/test",
          BRANCH_STATE_DIR: "/tmp/branch-state",
          BRANCH_LOG_PREFIX: "gateway",
        },
        systemdServiceName: "branch-gateway",
        windowsTaskName: "Branch Agent Gateway",
      }),
    ).toEqual([
      "Launchd stdout and stderr (if installed): /Users/test/Library/Logs/branch/gateway.log",
      "Restart attempts: /tmp/branch-state/logs/gateway-restart.log",
    ]);
  });

  it("renders systemd and windows hints by platform", () => {
    expect(
      buildPlatformRuntimeLogHints({
        platform: "linux",
        env: {
          BRANCH_STATE_DIR: "/tmp/branch-state",
        },
        systemdServiceName: "branch-gateway",
        windowsTaskName: "Branch Agent Gateway",
      }),
    ).toEqual([
      "Logs: journalctl --user -u branch-gateway.service -n 200 --no-pager",
      "Restart attempts: /tmp/branch-state/logs/gateway-restart.log",
    ]);
    expect(
      buildPlatformRuntimeLogHints({
        platform: "win32",
        env: {
          BRANCH_STATE_DIR: "/tmp/branch-state",
        },
        systemdServiceName: "branch-gateway",
        windowsTaskName: "Branch Agent Gateway",
      }),
    ).toEqual([
      'Logs: schtasks /Query /TN "Branch Agent Gateway" /V /FO LIST',
      "Restart attempts: /tmp/branch-state/logs/gateway-restart.log",
    ]);
  });
});

describe("buildPlatformServiceStartHints", () => {
  it("builds platform-specific service start hints", () => {
    expect(
      buildPlatformServiceStartHints({
        platform: "darwin",
        installHint: "branch gateway install",
        startCommand: "branch gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.branch.gateway.plist",
        systemdServiceName: "branch-gateway",
        windowsTaskName: "Branch Agent Gateway",
      }),
    ).toEqual([
      "branch gateway install",
      "branch gateway",
      "launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.branch.gateway.plist",
    ]);
    expect(
      buildPlatformServiceStartHints({
        platform: "linux",
        installHint: "branch gateway install",
        startCommand: "branch gateway",
        launchAgentPlistPath: "~/Library/LaunchAgents/com.branch.gateway.plist",
        systemdServiceName: "branch-gateway",
        windowsTaskName: "Branch Agent Gateway",
      }),
    ).toEqual([
      "branch gateway install",
      "branch gateway",
      "systemctl --user start branch-gateway.service",
    ]);
  });
});
