import { describe, expect, it } from "vitest";
import { buildWindowsCmdExeCommandLine } from "../process/windows-command.js";
import { buildSupervisedExitWatcherCommand } from "./server-reload-handlers.process.test-support.js";

describe("supervised cron exit watcher command", () => {
  const execPath = "C:\\hostedtoolcache\\node.exe";
  const childArgs = [
    "C:\\Temp\\branch-cron-exit-reload-x\\watcher.cjs",
    "C:\\Temp\\branch-cron-exit-reload-x\\watcher-runs.txt",
    "C:\\Temp\\branch-cron-exit-reload-x\\release-watcher",
  ];

  it("does not add a cmd.exe /s outer quote layer on Windows", () => {
    const command = buildSupervisedExitWatcherCommand(execPath, childArgs, "win32");
    expect(command).toBe(
      `"${execPath}" "${childArgs[0]}" "${childArgs[1]}" "${childArgs[2]}"`,
    );
    expect(command).not.toBe(buildWindowsCmdExeCommandLine(execPath, childArgs));
    expect(command.startsWith('""')).toBe(false);
  });

  it("JSON-quotes argv for bash -lc on POSIX", () => {
    expect(buildSupervisedExitWatcherCommand("/usr/bin/node", ["/tmp/watcher.cjs"], "linux")).toBe(
      `${JSON.stringify("/usr/bin/node")} ${JSON.stringify("/tmp/watcher.cjs")}`,
    );
  });
});
