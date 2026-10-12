import { afterEach, describe, expect, it, vi } from "vitest";
import type { LaneState } from "../../scripts/lib/cross-os-release-checks/config.ts";

const mocks = vi.hoisted(() => ({
  runInstalledCli: vi.fn(),
  runBranch: vi.fn(),
}));

vi.mock("../../scripts/lib/cross-os-release-checks/installed.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../scripts/lib/cross-os-release-checks/installed.ts")
  >()),
  runInstalledCli: mocks.runInstalledCli,
}));

vi.mock("../../scripts/lib/cross-os-release-checks/runtime.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../scripts/lib/cross-os-release-checks/runtime.ts")
  >()),
  runBranch: mocks.runBranch,
}));

import { installLaneCompanions } from "../../scripts/lib/cross-os-release-checks/lane-companions.ts";

function createLane(): LaneState {
  return {
    name: "fresh",
    rootDir: "/tmp/branch-release",
    prefixDir: "/tmp/branch-release/prefix",
    homeDir: "/tmp/branch-release/home",
    stateDir: "/tmp/branch-release/state",
    appDataDir: "/tmp/branch-release/app-data",
    gatewayPort: 18789,
    phaseTimings: [],
  };
}

describe("cross-OS release companion installation", () => {
  afterEach(() => {
    mocks.runInstalledCli.mockReset();
    mocks.runBranch.mockReset();
  });

  it.each([
    { cliPath: undefined, runner: "packaged", supported: true },
    { cliPath: "/tmp/branch", runner: "installed", supported: false },
  ] as const)(
    "probes capability consent once through the $runner runner (supported=$supported)",
    async ({ cliPath, supported }) => {
      const lane = createLane();
      const env = { HOME: lane.homeDir };
      const runner = cliPath ? mocks.runInstalledCli : mocks.runBranch;
      const unusedRunner = cliPath ? mocks.runBranch : mocks.runInstalledCli;
      runner
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: supported ? "  --accept-capabilities  Accept declared capabilities\n" : "Usage\n",
          stderr: "",
        })
        .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

      await installLaneCompanions({
        companions: [
          { name: "@branch/codex", tarballPath: "/tmp/branch-codex.tgz" },
          { name: "@branch/discord", tarballPath: "/tmp/branch-discord.tgz" },
        ],
        logsDir: "/tmp/branch-release/logs",
        lane,
        env,
        ...(cliPath ? { cliPath } : {}),
      });

      expect(runner).toHaveBeenCalledTimes(3);
      expect(runner).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ args: ["plugins", "install", "--help"], env }),
      );
      for (const [callIndex, tarball] of [
        [2, "/tmp/branch-codex.tgz"],
        [3, "/tmp/branch-discord.tgz"],
      ] as const) {
        expect(runner).toHaveBeenNthCalledWith(
          callIndex,
          expect.objectContaining({
            args: [
              "plugins",
              "install",
              `npm-pack:${tarball}`,
              "--force",
              ...(supported ? ["--accept-capabilities"] : []),
            ],
            env,
          }),
        );
      }
      expect(unusedRunner).not.toHaveBeenCalled();
    },
  );

  it("fails the lane when the help probe fails", async () => {
    const lane = createLane();
    mocks.runBranch.mockRejectedValueOnce(new Error("help probe failed"));

    await expect(
      installLaneCompanions({
        companions: [{ name: "@branch/codex", tarballPath: "/tmp/branch-codex.tgz" }],
        logsDir: "/tmp/branch-release/logs",
        lane,
        env: { HOME: lane.homeDir },
      }),
    ).rejects.toThrow("help probe failed");
    expect(mocks.runBranch).toHaveBeenCalledTimes(1);
  });
});
