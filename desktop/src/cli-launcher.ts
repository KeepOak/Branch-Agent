// The `branch` command: a stable launcher that reads a pointer the app writes, so updates and app
// moves do not hard-code a per-build path. Only a launcher Branch created (marker, or the old
// installer/shim signatures) is rewritten; a user's own `branch` file is left alone.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const CLI_LAUNCHER_MARKER = "# Created by Branch Agent";
export const CLI_LAUNCHER_CMD_MARKER = "@rem Created by Branch Agent";
export const CLI_LAUNCHER_REPAIR_MESSAGE = "Open Branch once to repair the branch command.";

export interface CliActive {
  dataDir: string;
  nodePath: string;
  engineDir: string;
  gatewayPort: number;
}

const readFirstLine = (file: string): string => {
  try { return readFileSync(file, "utf8").split(/\r?\n/, 1)[0]?.trim() ?? ""; }
  catch { return ""; }
};

export function cliPointerPath(dataDir: string): string {
  return join(dataDir, "cli-active");
}

/** The engine folder `branch` should run: the one actually running, else the published one, else the fallback. */
export function activeEngineDir(dataDir: string, fallbackEngine: string): string {
  return readFirstLine(join(dataDir, "engine-running.txt"))
    || readFirstLine(join(dataDir, "engine-current.txt"))
    || fallbackEngine;
}

export function cliEntryPath(engineDir: string): string {
  return join(engineDir, "branch.mjs");
}

export function cliTargetExists(active: CliActive): boolean {
  const engine = activeEngineDir(active.dataDir, active.engineDir);
  return existsSync(active.nodePath) && existsSync(cliEntryPath(engine));
}

export function writeCliPointer(active: CliActive): void {
  mkdirSync(active.dataDir, { recursive: true });
  writeAtomic(cliPointerPath(active.dataDir), [
    CLI_LAUNCHER_MARKER,
    `dataDir=${active.dataDir}`,
    `nodePath=${active.nodePath}`,
    `engineDir=${active.engineDir}`,
    `gatewayPort=${active.gatewayPort}`,
    "",
  ].join("\n"));
}

export function readCliPointer(file: string): CliActive | undefined {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { return undefined; }
  const value = (key: string): string => {
    const line = text.split(/\r?\n/).find((row) => row.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1) : "";
  };
  const dataDir = value("dataDir"), nodePath = value("nodePath"), engineDir = value("engineDir");
  const gatewayPort = Number(value("gatewayPort"));
  if (!dataDir || !nodePath) return undefined;
  return { dataDir, nodePath, engineDir, gatewayPort: Number.isInteger(gatewayPort) ? gatewayPort : 19031 };
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

/** Stable POSIX launcher: the only baked-in path is the pointer file the app rewrites. */
export function posixCliLauncher(pointerFile: string): string {
  return [
    "#!/bin/sh",
    CLI_LAUNCHER_MARKER,
    `pointer=${shellQuote(pointerFile)}`,
    `repair() { echo ${shellQuote(CLI_LAUNCHER_REPAIR_MESSAGE)} >&2; exit 1; }`,
    "[ -f \"$pointer\" ] || repair",
    "dataDir=; nodePath=; engine=; BRANCH_GATEWAY_PORT=19031",
    "while IFS= read -r line || [ -n \"$line\" ]; do",
    "  line=$(printf '%s' \"$line\" | tr -d '\\r')",
    "  case \"$line\" in",
    "    dataDir=*) dataDir=${line#dataDir=} ;;",
    "    nodePath=*) nodePath=${line#nodePath=} ;;",
    "    engineDir=*) engine=${line#engineDir=} ;;",
    "    gatewayPort=*) BRANCH_GATEWAY_PORT=${line#gatewayPort=} ;;",
    "  esac",
    "done < \"$pointer\"",
    "[ -n \"$dataDir\" ] && [ -n \"$nodePath\" ] || repair",
    "if [ -f \"$dataDir/engine-current.txt\" ]; then engine=$(head -n 1 \"$dataDir/engine-current.txt\" | tr -d '\\r'); fi",
    "if [ -f \"$dataDir/engine-running.txt\" ]; then running=$(head -n 1 \"$dataDir/engine-running.txt\" | tr -d '\\r'); if [ -n \"$running\" ]; then engine=$running; fi; fi",
    "[ -f \"$nodePath\" ] && [ -n \"$engine\" ] && [ -f \"$engine/branch.mjs\" ] || repair",
    "if [ -f \"$dataDir/gateway-token\" ]; then BRANCH_GATEWAY_TOKEN=$(head -n 1 \"$dataDir/gateway-token\" | tr -d '\\r'); export BRANCH_GATEWAY_TOKEN; fi",
    "BRANCH_PROFILE=default",
    "BRANCH_HOME=\"$dataDir/home\"",
    "BRANCH_STATE_DIR=\"$BRANCH_HOME/.branch\"",
    "BRANCH_CONFIG_PATH=\"$BRANCH_STATE_DIR/branch.json\"",
    "if [ -f \"$dataDir/gateway-port\" ]; then live=$(head -n 1 \"$dataDir/gateway-port\" | tr -d '\\r'); if [ -n \"$live\" ]; then BRANCH_GATEWAY_PORT=$live; fi; fi",
    "BRANCH_DATA=\"$dataDir\"",
    "export BRANCH_DATA BRANCH_PROFILE BRANCH_HOME BRANCH_STATE_DIR BRANCH_CONFIG_PATH BRANCH_GATEWAY_PORT",
    "exec \"$nodePath\" \"$engine/branch.mjs\" \"$@\"",
    "",
  ].join("\n");
}

export function isOwnedCliLauncher(contents: string): boolean {
  if (contents.includes(CLI_LAUNCHER_MARKER) || contents.includes(CLI_LAUNCHER_CMD_MARKER)) return true;
  // Old macOS installer: hardcoded app-bundle cli.js that app.asar no longer ships.
  if (/Contents[/\\]Resources[/\\]app[/\\]dist[/\\]cli\.js/.test(contents)) return true;
  // Existing desktop Windows shims from before the marker.
  return contents.includes("engine-current.txt") && contents.includes("engine-running.txt")
    && contents.includes("branch.mjs") && contents.includes("BRANCH_DATA");
}

export function defaultCliBinDir(dataDir: string, platform = process.platform, home = homedir()): string {
  if (process.env.BRANCH_CLI_BIN_DIR) return process.env.BRANCH_CLI_BIN_DIR;
  // Scratch test copies keep their launcher inside the isolated data folder.
  if (process.env.BRANCH_DESKTOP_TEST === "1") return join(dataDir, "bin");
  return platform === "win32" ? join(dataDir, "bin") : join(home, ".local", "bin");
}

export function defaultCliLauncherPath(dataDir: string, platform = process.platform, home = homedir()): string {
  return join(defaultCliBinDir(dataDir, platform, home), platform === "win32" ? "branch.cmd" : "branch");
}

export interface EnsureCliLauncherOptions {
  launcherPath: string;
  active: CliActive;
  /** When false, rewrite an owned launcher but never create a missing one. */
  create: boolean;
  /** cmd for Windows branch.cmd; sh for the POSIX / Git Bash launcher. */
  kind?: "sh" | "cmd";
  /** Windows cmd/Git-Bash text when kind is cmd, or a custom generator. */
  contents?: string;
}

export interface EnsureCliLauncherResult {
  action: "wrote" | "unchanged" | "skipped" | "pointer";
}

function desiredLauncher(options: EnsureCliLauncherOptions): string {
  if (options.contents !== undefined) return options.contents;
  return posixCliLauncher(cliPointerPath(options.active.dataDir));
}

/** Write the pointer; rewrite an owned launcher when its target or data folder is missing or wrong. */
export function ensureCliLauncher(options: EnsureCliLauncherOptions): EnsureCliLauncherResult {
  const previous = readCliPointer(cliPointerPath(options.active.dataDir));
  const pointerChanged = !previous
    || previous.dataDir !== options.active.dataDir
    || previous.nodePath !== options.active.nodePath
    || previous.engineDir !== options.active.engineDir
    || previous.gatewayPort !== options.active.gatewayPort;
  writeCliPointer(options.active);
  const desired = desiredLauncher(options);
  let existing: string | undefined;
  try { existing = readFileSync(options.launcherPath, "utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (existing === undefined) {
    if (!options.create) return { action: "pointer" };
    writeLauncherFile(options.launcherPath, desired, options.kind ?? "sh");
    return { action: "wrote" };
  }
  if (!isOwnedCliLauncher(existing)) return { action: "skipped" };
  if (existing === desired && !pointerChanged && cliTargetExists(options.active)) return { action: "unchanged" };
  if (existing !== desired) writeLauncherFile(options.launcherPath, desired, options.kind ?? "sh");
  return { action: "wrote" };
}

function writeLauncherFile(file: string, contents: string, kind: "sh" | "cmd"): void {
  mkdirSync(dirname(file), { recursive: true });
  writeAtomic(file, contents);
  if (kind === "sh" && process.platform !== "win32") chmodSync(file, 0o755);
}

function writeAtomic(file: string, contents: string): void {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, contents);
  try { renameSync(temporary, file); }
  catch {
    writeFileSync(file, contents);
    try { unlinkSync(temporary); } catch { /* leftover temp is harmless */ }
  }
}
