import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REA_ENTRY_RELATIVE = "node_modules/rea-agents/scripts/rea.mjs";

export function reaEntryPath(pinDir) {
  return path.join(pinDir, REA_ENTRY_RELATIVE);
}

export function npmCiArgs() {
  return ["ci", "--ignore-scripts", "--no-audit", "--no-fund"];
}

export function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/** Install rea-agents from the committed lockfile. npm ci checks the integrity hash. */
export function installLockedRea(pinDir, run = spawnSync) {
  const result = run(npmCommand(), npmCiArgs(), {
    cwd: pinDir,
    stdio: ["ignore", "ignore", "inherit"],
    windowsHide: true,
  });
  if (result?.error) {
    throw result.error;
  }
  if (result?.status !== 0) {
    throw new Error("npm ci failed for the locked REA install");
  }
}

export function defaultStart(entry, args) {
  const child = spawn(process.execPath, [entry, ...args], {
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
}

/**
 * Install the locked package when its entry file is missing, then start the server.
 * A present node_modules entry skips npm ci.
 */
export function startLockedReaServer(options) {
  const entry = reaEntryPath(options.pinDir);
  const exists = options.entryExists ?? existsSync;
  if (!exists(entry)) {
    options.install(options.pinDir);
  }
  options.start(entry, options.args);
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  try {
    startLockedReaServer({
      pinDir: path.dirname(fileURLToPath(import.meta.url)),
      args: process.argv.slice(2),
      install: installLockedRea,
      start: defaultStart,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
