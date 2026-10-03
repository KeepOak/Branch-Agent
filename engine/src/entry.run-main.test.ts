import { describe, expect, it, vi } from "vitest";
import { ExpectedCliError } from "./cli/failure-output.js";
import { runMainOrRootHelp } from "./entry.js";

describe("entry run-main boundary", () => {
  it("retains JSON console routing through process finalization", async () => {
    const runCli = vi.fn(async () => undefined);

    await runMainOrRootHelp(["node", "branch", "status"], {
      loadRunCli: async () => ({ runCli }),
    });

    expect(runCli).toHaveBeenCalledWith(["node", "branch", "status"], {
      additionalStartupTrace: expect.any(Object),
      runtimeRecoveryEnv: expect.any(Object),
      retainConsoleRoutingUntilProcessExit: true,
    });
  });

  it("frames a command-phase failure as a command failure, not a startup failure", async () => {
    const previousExitCode = process.exitCode;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    try {
      await runMainOrRootHelp(["node", "branch", "onboard", "recommendations"], {
        loadRunCli: async () => ({
          runCli: vi.fn(async () => {
            throw new Error(
              "Multiple agents are configured, but this operation has no explicit owner.",
            );
          }),
        }),
      });
      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith("[branch] The CLI command failed.");
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("Could not start the CLI"));
    } finally {
      errorSpy.mockRestore();
      process.exitCode = previousExitCode;
    }
  });

  it("frames a failure before the command runs as a startup failure", async () => {
    const previousExitCode = process.exitCode;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;
    try {
      await runMainOrRootHelp(["node", "branch", "status"], {
        loadRunCli: async () => {
          throw new Error("cannot load run-main");
        },
      });
      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith("[branch] Could not start the CLI.");
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining("The CLI command failed"));
    } finally {
      errorSpy.mockRestore();
      process.exitCode = previousExitCode;
    }
  });

  it("keeps expected conditions at exit 1 without crash framing", async () => {
    const previousExitCode = process.exitCode;
    const message =
      'The `branch canopy` command is provided by the "canopy" plugin, but that bundled plugin is disabled by default. Run `branch plugins enable canopy` to enable that CLI surface.';
    const error = new ExpectedCliError({
      message,
      humanOutput: message,
      machineOutput: message,
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.exitCode = undefined;

    try {
      await runMainOrRootHelp(["node", "branch", "canopy", "list"], {
        loadRunCli: async () => ({
          runCli: vi.fn(async () => {
            throw error;
          }),
        }),
      });

      expect(process.exitCode).toBe(1);
      expect(errorSpy.mock.calls).toEqual([[message]]);
    } finally {
      errorSpy.mockRestore();
      process.exitCode = previousExitCode;
    }
  });
});
