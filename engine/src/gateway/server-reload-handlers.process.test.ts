import { describe, expect, it } from "vitest";
import { buildWindowsCmdExeCommandLine } from "../process/windows-command.js";
import { resolveExitWatchShell } from "./cron-exit-watch-shell.js";
import {
  buildSupervisedExitWatcherCommand,
  buildSupervisedExitWatcherScript,
} from "./server-reload-handlers.process.test-support.js";

describe("supervised cron exit watcher command", () => {
  const execPath = "C:\\hostedtoolcache\\node.exe";
  const childArgs = [
    "C:\\Temp\\branch-cron-exit-reload-x\\watcher.cjs",
    "C:\\Temp\\branch-cron-exit-reload-x\\watcher-runs.txt",
    "C:\\Temp\\branch-cron-exit-reload-x\\release-watcher",
  ];

  it("passes one unquoted /c argument for a non-verbatim cmd.exe spawn", () => {
    const command = buildSupervisedExitWatcherCommand(execPath, childArgs, "win32");
    const shell = resolveExitWatchShell("win32");
    expect(command).toBe([execPath, ...childArgs].join(" "));
    expect(command).not.toContain('"');
    expect(command).not.toBe(buildWindowsCmdExeCommandLine(execPath, childArgs));
    expect(shell.argsFor(command)).toEqual(["/d", "/s", "/c", command]);
    expect(shell.argsFor(command)).toHaveLength(4);
  });

  it("rejects spaces and quotes that cannot survive non-verbatim cmd.exe", () => {
    expect(() =>
      buildSupervisedExitWatcherCommand("C:\\Program Files\\node.exe", childArgs, "win32"),
    ).toThrow(/Unsafe Windows cmd.exe argument/);
    expect(() =>
      buildSupervisedExitWatcherCommand(execPath, ['C:\\Temp\\"quoted"\\watcher.cjs'], "win32"),
    ).toThrow(/Unsafe Windows cmd.exe argument/);
  });

  it("bakes marker and release paths so cmd.exe argv cannot hide the release file", () => {
    const markerPath = "C:\\Temp\\branch-cron-exit-reload-x\\watcher-runs.txt";
    const releasePath = "C:\\Temp\\branch-cron-exit-reload-x\\release-watcher";
    const script = buildSupervisedExitWatcherScript(markerPath, releasePath);
    expect(script).toContain(`const marker=${JSON.stringify(markerPath)}`);
    expect(script).toContain(`const release=${JSON.stringify(releasePath)}`);
    expect(script).not.toContain("process.argv[2]");
    expect(script).not.toContain("process.argv[3]");
    expect(script.indexOf("setInterval")).toBeLessThan(script.indexOf("watcher-ready"));
    expect(script).toContain("fs.appendFileSync(marker,'run\\n')");
    expect(script).toContain("process.stdout.write('watcher-ready\\n')");
  });

  it("JSON-quotes argv for bash -lc on POSIX", () => {
    expect(buildSupervisedExitWatcherCommand("/usr/bin/node", ["/tmp/watcher.cjs"], "linux")).toBe(
      `${JSON.stringify("/usr/bin/node")} ${JSON.stringify("/tmp/watcher.cjs")}`,
    );
    expect(resolveExitWatchShell("linux").argsFor("echo hi")).toEqual(["-lc", "echo hi"]);
  });
});
