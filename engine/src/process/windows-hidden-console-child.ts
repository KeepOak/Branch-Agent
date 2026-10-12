import { spawn, type ChildProcess } from "node:child_process";
import {
  ensureHiddenConsoleForDescendants,
  tryEnsureHiddenConsoleForDescendants,
} from "./windows-hidden-console.js";

/** Start a console child even if preparing an inheritable hidden console fails. */
export async function spawnWithHiddenConsole(
  command: string,
  argv: string[],
  shell: boolean,
  retainJob: () => Promise<void>,
  ensure: () => Promise<void> = ensureHiddenConsoleForDescendants,
  warn?: (message: string) => void,
): Promise<ChildProcess> {
  const hidden = await tryEnsureHiddenConsoleForDescendants(ensure, warn);
  if (hidden) {
    await retainJob();
  }
  return spawn(command, argv, {
    cwd: process.cwd(),
    env: process.env,
    shell,
    stdio: "inherit",
    // Failed setup must preserve the old CREATE_NO_WINDOW spawn behaviour.
    windowsHide: !hidden,
  });
}
