import { retainWindowsProcessJobUntilExit } from "./supervisor/service-child-windows-job-native.js";
import { spawnWithHiddenConsole } from "./windows-hidden-console-child.js";

async function main(): Promise<void> {
  const [shellFlag, command, ...argv] = process.argv.slice(2);
  if ((shellFlag !== "0" && shellFlag !== "1") || !command) {
    throw new Error("Hidden-console launcher requires a command");
  }
  // Closing this launcher (including a forced parent kill) closes the Job and
  // terminates Codex and its console grandchildren instead of orphaning them.
  const child = await spawnWithHiddenConsole(command, argv, shellFlag === "1", async () => {
    const koffi = (await import("koffi")).default;
    retainWindowsProcessJobUntilExit(koffi);
  });
  child.once("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
