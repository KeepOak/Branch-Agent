import fs from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { onTestFinished, vi } from "vitest";
import { createFixtureLifetime } from "../../test/helpers/fixture-lifetime.js";
import { createDeferred } from "../../test/helpers/promise.js";
import { getProcessSupervisor } from "../process/supervisor/index.js";
import type { ManagedRun } from "../process/supervisor/types.js";

export const fixtureLifetime = createFixtureLifetime();

const WINDOWS_UNSAFE_CMD_CHARS_RE = /[\s"&|<>%\r\n]/;

/** Cron wraps this string in `bash -lc` or `cmd.exe /d /s /c` as one argv and
 * does not set `windowsVerbatimArguments`. Join Windows paths unquoted; quotes
 * become `\"` under libuv and `cmd /s` never starts the watcher. */
export function buildSupervisedExitWatcherCommand(
  execPath: string,
  childArgs: readonly string[],
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === "win32") {
    const argv = [execPath, ...childArgs];
    for (const argument of argv) {
      if (WINDOWS_UNSAFE_CMD_CHARS_RE.test(argument)) {
        throw new Error(
          `Unsafe Windows cmd.exe argument detected: ${JSON.stringify(argument)}. ` +
            "Pass an explicit shell-wrapper argv at the call site instead.",
        );
      }
    }
    return argv.join(" ");
  }
  return [execPath, ...childArgs].map((argument) => JSON.stringify(argument)).join(" ");
}

function watcherHasStarted(stdout: string, markerPath: string): boolean {
  if (stdout.includes("watcher-ready")) {
    return true;
  }
  try {
    return fs.readFileSync(markerPath, "utf8").includes("run");
  } catch {
    return false;
  }
}

/** Bake marker/release paths into the child so `cmd.exe /d /s /c` argv splitting
 * cannot point the poll at a different file than the test writes. Start the
 * release poll before stdout so a blocked pipe cannot prevent exit. */
export function buildSupervisedExitWatcherScript(markerPath: string, releasePath: string): string {
  return (
    "const fs=require('node:fs');" +
    `const marker=${JSON.stringify(markerPath)};` +
    `const release=${JSON.stringify(releasePath)};` +
    "fs.appendFileSync(marker,'run\\n');" +
    "const timer=setInterval(()=>{if(fs.existsSync(release)){clearInterval(timer);process.exit(0)}},10);" +
    "process.stdout.write('watcher-ready\\n');"
  );
}

export async function createSupervisedExitWatcherFixture(fixtureDir: string) {
  const childScriptPath = path.join(fixtureDir, "watcher.cjs");
  const markerPath = path.join(fixtureDir, "watcher-runs.txt");
  const releasePath = path.join(fixtureDir, "release-watcher");
  await writeFile(
    childScriptPath,
    buildSupervisedExitWatcherScript(markerPath, releasePath),
    "utf8",
  );
  const childArgs = [childScriptPath, markerPath, releasePath];
  const command = buildSupervisedExitWatcherCommand(process.execPath, childArgs);
  const supervisor = getProcessSupervisor();
  const childStarted = createDeferred();
  const spawning = createDeferred<ManagedRun>();
  // Reconciliation can handle a rejected spawn before the test joins its receipt.
  void spawning.promise.catch(() => {});
  const spawnChild = supervisor.spawn.bind(supervisor);
  let stdout = "";
  let spawnedRun: Promise<ManagedRun> | ManagedRun | undefined;
  const markStarted = () => {
    childStarted.resolve();
  };
  const markerPoll = setInterval(() => {
    if (watcherHasStarted(stdout, markerPath)) {
      clearInterval(markerPoll);
      markStarted();
    }
  }, 10);
  markerPoll.unref?.();
  const spawn = vi.spyOn(supervisor, "spawn").mockImplementation((input) => {
    const run = spawnChild({
      ...input,
      onStdout: (chunk) => {
        input.onStdout?.(chunk);
        stdout += chunk;
        if (watcherHasStarted(stdout, markerPath)) {
          markStarted();
        }
      },
    });
    spawnedRun = run;
    spawning.resolve(run);
    return run;
  });
  onTestFinished(async () => {
    clearInterval(markerPoll);
    await writeFile(releasePath, "release").catch(() => {});
    if (!spawnedRun) {
      return;
    }
    const run = await spawnedRun;
    run.cancel("manual-cancel");
    await run.wait().catch(() => {});
    await run.waitForExtinction?.().catch(() => {});
  });
  return {
    markerPath,
    releasePath,
    command,
    childStarted: childStarted.promise,
    spawning: spawning.promise,
    spawn,
  };
}

export function waitForFast<T>(
  callback: () => T | Promise<T>,
  options: { timeout?: number; interval?: number } = {},
) {
  return vi.waitFor(callback, { interval: 1, ...options });
}
