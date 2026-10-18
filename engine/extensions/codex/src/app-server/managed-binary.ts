/**
 * Resolves the managed Codex app-server binary shipped with or installed beside
 * the Codex plugin before stdio startup.
 */
import { constants as fsConstants, existsSync, realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { resolveGlobalSingleton } from "branch/plugin-sdk/global-singleton";
import type { CodexAppServerStartOptions, CodexManagedCommandOrder } from "./config.js";
import { resolveMacOSDesktopCodexAppServerCommandCandidates } from "./desktop-app-paths.js";
import { CodexNotInstalledError, type InstalledCodex } from "./installed-codex.js";
import { CodexRuntimeUnavailableError, type CodexOnDemand } from "./on-demand.js";
import { MANAGED_CODEX_APP_SERVER_PACKAGE } from "./version.js";

// Registration and lazy runtime artifacts can load separate module copies.
// They must resolve dependencies from the same loader-owned plugin root.
const registeredCodexPlugin = resolveGlobalSingleton<{ root?: string }>(
  Symbol.for("branch.codexManagedPluginRoot"),
  () => ({}),
);

/**
 * Where the plugin looks for the Codex installed on this computer (release
 * builds ship no Codex binary). Unset means the bundled package is the only
 * managed source, as before.
 */
export type ManagedCodexInstalled = Pick<InstalledCodex, "findPathCommand">;

const registeredCodexInstalled = resolveGlobalSingleton<{ provider?: ManagedCodexInstalled }>(
  Symbol.for("branch.codexManagedInstalled"),
  () => ({}),
);

/**
 * The first-use download (on-demand.ts). Unset means a missing Codex stays
 * missing; registering it is what starts the download.
 */
export type ManagedCodexOnDemand = Pick<
  CodexOnDemand,
  | "findPathCommand"
  | "installedLauncher"
  | "ensureLauncher"
  | "status"
  | "downloadAllowed"
  | "askMessage"
  | "waitForDownloadConsent"
>;

const registeredCodexOnDemand = resolveGlobalSingleton<{ provider?: ManagedCodexOnDemand }>(
  Symbol.for("branch.codexManagedOnDemand"),
  () => ({}),
);

type ResolveManagedCodexAppServerOptions = {
  platform?: NodeJS.Platform;
  pluginRoot?: string;
  pathExists?: (filePath: string, platform: NodeJS.Platform) => Promise<boolean>;
  /** Overrides the registered installed-Codex lookup; null disables it. */
  installed?: ManagedCodexInstalled | null;
  /** Overrides the registered first-use download; null disables it. */
  onDemand?: ManagedCodexOnDemand | null;
  /** False keeps a missing Codex missing (a sign-in check). True downloads on first use. */
  download?: boolean;
  /** Whether the bundled launcher has its native binary; defaults to a filesystem check. */
  bundledReady?: (launcher: string, platform: NodeJS.Platform) => boolean;
};

type ResolveManagedCodexNativeCommandOptions = {
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  pathExists?: (filePath: string) => boolean;
  resolvePackageJson?: (packageName: string, root: string) => string | undefined;
};

/** Records the process-stable plugin root prepared by Branch Agent's plugin loader. */
export function setManagedCodexPluginRoot(pluginRoot: string | undefined): void {
  registeredCodexPlugin.root = pluginRoot;
}

/** Records where the plugin looks for the Codex installed on this computer (PATH). */
export function setManagedCodexInstalled(provider: ManagedCodexInstalled | undefined): void {
  registeredCodexInstalled.provider = provider;
}

/** Records the first-use download. Without it, a missing Codex is not fetched. */
export function setManagedCodexOnDemand(provider: ManagedCodexOnDemand | undefined): void {
  registeredCodexOnDemand.provider = provider;
}

/** The on-demand Codex source the plugin registered, if any. */
export function getManagedCodexOnDemand(): ManagedCodexOnDemand | undefined {
  return registeredCodexOnDemand.provider;
}

/** A codex on PATH at or above the supported minimum, without starting anything. */
export async function resolveInstalledPathCodexCommand(): Promise<string | undefined> {
  return (await registeredCodexInstalled.provider?.findPathCommand())?.command;
}

/** The native binary of an already-downloaded Codex, without downloading. */
export async function resolveInstalledOnDemandCodexNativeCommand(): Promise<string | undefined> {
  const launcher = await registeredCodexOnDemand.provider?.installedLauncher();
  return launcher ? resolveManagedCodexNativeCommand(launcher) : undefined;
}

/** Rewrites managed stdio start options to point at an executable Codex binary path. */
export async function resolveManagedCodexAppServerStartOptions(
  startOptions: CodexAppServerStartOptions,
  options: ResolveManagedCodexAppServerOptions = {},
): Promise<CodexAppServerStartOptions> {
  if (startOptions.transport !== "stdio" || startOptions.commandSource !== "managed") {
    return startOptions;
  }

  const pluginRoot = options.pluginRoot ?? registeredCodexPlugin.root;
  if (!pluginRoot) {
    throw new Error(
      "Codex plugin root is unavailable. Load the Codex plugin before starting its managed app-server.",
    );
  }
  const platform = options.platform ?? process.platform;
  const managedCommandOrder = startOptions.managedCommandOrder ?? "package-first";
  const pathExists = options.pathExists ?? commandPathExists;
  const installed =
    options.installed === null
      ? undefined
      : (options.installed ?? registeredCodexInstalled.provider);
  const onDemand =
    options.onDemand === null ? undefined : (options.onDemand ?? registeredCodexOnDemand.provider);
  const bundledReady =
    options.bundledReady ??
    ((launcher: string, launcherPlatform: NodeJS.Platform) =>
      resolveManagedCodexNativeCommand(launcher, { platform: launcherPlatform }) !== undefined);
  const candidateCommandPaths = onDemand
    ? await resolveOnDemandCommandCandidates({
        pluginRoot,
        platform,
        managedCommandOrder,
        onDemand,
        pathExists,
        download: options.download ?? true,
        bundledReady,
      })
    : installed
      ? await resolveInstalledCommandCandidates({
          pluginRoot,
          platform,
          managedCommandOrder,
          installed,
          pathExists,
          bundledReady,
        })
      : resolveManagedCodexAppServerCommandCandidates(pluginRoot, platform, managedCommandOrder);
  const commandPaths: string[] = [];
  for (const commandPath of candidateCommandPaths) {
    if (await pathExists(commandPath, platform)) {
      commandPaths.push(commandPath);
    }
  }
  const [commandPath, ...managedFallbackCommandPaths] = commandPaths;
  if (commandPath === undefined) {
    throw new Error(
      [
        `Managed Codex app-server binary was not found for ${MANAGED_CODEX_APP_SERVER_PACKAGE}.`,
        "Reinstall or update Branch Agent, or run pnpm install in a source checkout.",
        "Set plugins.entries.codex.config.appServer.command or BRANCH_CODEX_APP_SERVER_BIN to use a custom Codex binary.",
      ].join(" "),
    );
  }

  return {
    ...startOptions,
    command: commandPath,
    commandSource: "resolved-managed",
    ...(managedFallbackCommandPaths.length > 0 ? { managedFallbackCommandPaths } : {}),
  };
}

/**
 * Whether starting this managed Codex now would first download it: nothing on
 * PATH, no bundled platform package, no verified download, and no desktop app
 * that comes first. A waiting turn uses this to show the download in the chat.
 */
export async function isManagedCodexDownloadPending(
  startOptions: CodexAppServerStartOptions,
  options: Omit<ResolveManagedCodexAppServerOptions, "download"> = {},
): Promise<boolean> {
  if (startOptions.transport !== "stdio" || startOptions.commandSource !== "managed") {
    return false;
  }
  const pluginRoot = options.pluginRoot ?? registeredCodexPlugin.root;
  const onDemand =
    options.onDemand === null ? undefined : (options.onDemand ?? registeredCodexOnDemand.provider);
  if (!pluginRoot || !onDemand) {
    return false;
  }
  const platform = options.platform ?? process.platform;
  const managedCommandOrder = startOptions.managedCommandOrder ?? "package-first";
  const pathExists = options.pathExists ?? commandPathExists;
  if (managedCommandOrder === "desktop-first") {
    for (const command of resolveMacOSDesktopCodexAppServerCommandCandidates(platform)) {
      if (await pathExists(command, platform)) {
        return false;
      }
    }
  }
  if (managedCommandOrder !== "package-only" && (await onDemand.findPathCommand())) {
    return false;
  }
  const bundledReady =
    options.bundledReady ??
    ((launcher: string, launcherPlatform: NodeJS.Platform) =>
      resolveManagedCodexNativeCommand(launcher, { platform: launcherPlatform }) !== undefined);
  const bundled = resolveManagedCodexPackageEntrypoint(pluginRoot);
  if (bundled && bundledReady(bundled, platform)) {
    return false;
  }
  return (await onDemand.installedLauncher()) === undefined;
}

/** Resolves the native artifact behind a successful managed launcher selection. */
export function resolveManagedCodexNativeCommand(
  command: string,
  options: ResolveManagedCodexNativeCommandOptions = {},
): string | undefined {
  const platform = options.platform ?? process.platform;
  if (isManagedCodexDesktopCommand(command, platform)) {
    return command;
  }
  const target = resolveCodexNativeTarget(platform, options.arch ?? process.arch);
  if (!target) {
    return undefined;
  }
  const packageRoot = resolveManagedCodexPackageRootForCommand(command, platform);
  if (!packageRoot) {
    return undefined;
  }
  const resolvePackageJson = options.resolvePackageJson ?? resolvePackageJsonFromRoot;
  const pathExists = options.pathExists ?? existsSync;
  // The npm entrypoint selects the platform package before checking its binary.
  // An incomplete platform package must not attest a different embedded executable.
  const packageJsonPath =
    resolvePackageJson(target.packageName, packageRoot) ??
    resolvePackageJson(MANAGED_CODEX_APP_SERVER_PACKAGE, packageRoot);
  if (!packageJsonPath) {
    return undefined;
  }
  // Paths follow the target platform, so a macOS layout reads the same on any host.
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const candidate = pathApi.join(
    pathApi.dirname(packageJsonPath),
    "vendor",
    target.triple,
    "bin",
    platform === "win32" ? "codex.exe" : "codex",
  );
  return pathExists(candidate) ? candidate : undefined;
}

/** Recognizes only the official npm entrypoint, not arbitrary configured wrappers. */
export function resolvePackagedCodexNativeCommand(entrypoint: string): string | undefined {
  const packageRoot = path.dirname(path.dirname(entrypoint));
  if (
    path.basename(packageRoot) !== "codex" ||
    path.basename(path.dirname(packageRoot)) !== "@openai" ||
    path.relative(packageRoot, entrypoint) !== path.join("bin", "codex.js")
  ) {
    return undefined;
  }
  return resolveManagedCodexNativeCommand(entrypoint);
}

/** Returns whether a command is one of the standard macOS desktop app executables. */
export function isManagedCodexDesktopCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return (
    platform === "darwin" &&
    resolveMacOSDesktopCodexAppServerCommandCandidates(platform).includes(command)
  );
}

function resolveManagedCodexPackageRootForCommand(
  command: string,
  platform: NodeJS.Platform,
): string | undefined {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const commandPaths = [command];
  try {
    commandPaths.unshift(realpathSync(command));
  } catch {
    // Lexical .bin shims still identify their adjacent package root.
  }
  for (const commandPath of commandPaths) {
    let current = pathApi.dirname(commandPath);
    while (true) {
      if (
        pathApi.basename(current) === "codex" &&
        pathApi.basename(pathApi.dirname(current)) === "@openai"
      ) {
        return current;
      }
      if (pathApi.basename(current) === ".bin") {
        return pathApi.join(pathApi.dirname(current), "@openai", "codex");
      }
      const parent = pathApi.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }
  return undefined;
}

function resolveCodexNativeTarget(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): { packageName: string; triple: string } | undefined {
  // Mirrors @openai/codex's launcher mapping; this resolves identity only and
  // leaves process environment/launch behavior with the upstream entrypoint.
  if ((platform === "linux" || platform === "android") && arch === "x64") {
    return { packageName: "@openai/codex-linux-x64", triple: "x86_64-unknown-linux-musl" };
  }
  if ((platform === "linux" || platform === "android") && arch === "arm64") {
    return { packageName: "@openai/codex-linux-arm64", triple: "aarch64-unknown-linux-musl" };
  }
  if (platform === "darwin" && arch === "x64") {
    return { packageName: "@openai/codex-darwin-x64", triple: "x86_64-apple-darwin" };
  }
  if (platform === "darwin" && arch === "arm64") {
    return { packageName: "@openai/codex-darwin-arm64", triple: "aarch64-apple-darwin" };
  }
  if (platform === "win32" && arch === "x64") {
    return { packageName: "@openai/codex-win32-x64", triple: "x86_64-pc-windows-msvc" };
  }
  if (platform === "win32" && arch === "arm64") {
    return { packageName: "@openai/codex-win32-arm64", triple: "aarch64-pc-windows-msvc" };
  }
  return undefined;
}

function resolvePackageJsonFromRoot(packageName: string, root: string): string | undefined {
  try {
    const manifestPath = realpathSync(path.join(root, "package.json"));
    return createRequire(manifestPath).resolve(`${packageName}/package.json`);
  } catch {
    return undefined;
  }
}

/**
 * Managed candidates when Codex can come from PATH or a first-use download:
 * a user-installed codex on PATH (meeting the minimum) first, then the pinned
 * Codex (bundled package, else the verified per-user download). The download
 * runs only when nothing else can start Codex; if it fails while a desktop
 * Codex app is installed, the app is used, otherwise the reason is thrown.
 */
async function resolveOnDemandCommandCandidates(params: {
  pluginRoot: string;
  platform: NodeJS.Platform;
  managedCommandOrder: CodexManagedCommandOrder;
  onDemand: ManagedCodexOnDemand;
  pathExists: (filePath: string, platform: NodeJS.Platform) => Promise<boolean>;
  download: boolean;
  bundledReady: (launcher: string, platform: NodeJS.Platform) => boolean;
}): Promise<string[]> {
  const { platform, managedCommandOrder, onDemand } = params;
  const packageOnly = managedCommandOrder === "package-only";
  const desktopCommandPaths = packageOnly
    ? []
    : resolveMacOSDesktopCodexAppServerCommandCandidates(platform);
  const installedDesktop: string[] = [];
  for (const command of desktopCommandPaths) {
    if (await params.pathExists(command, platform)) {
      installedDesktop.push(command);
    }
  }
  const onPath = packageOnly ? undefined : (await onDemand.findPathCommand())?.command;
  const bundled = resolveManagedCodexPackageEntrypoint(params.pluginRoot);
  let pinned =
    bundled && params.bundledReady(bundled, platform)
      ? bundled
      : await onDemand.installedLauncher();
  const desktopFirst = managedCommandOrder === "desktop-first" && installedDesktop.length > 0;
  if (!pinned && !onPath && !desktopFirst) {
    const agreed = params.download && onDemand.downloadAllowed();
    if (!agreed && installedDesktop.length === 0) {
      throw new CodexRuntimeUnavailableError(
        "not-downloaded",
        onDemand.askMessage() ??
          "Codex is not downloaded yet. Branch Agent downloads it the first time Codex is used.",
      );
    }
    if (agreed) {
      try {
        pinned = await onDemand.ensureLauncher();
      } catch (error) {
        if (installedDesktop.length === 0) {
          throw error;
        }
      }
    }
  }
  const packageCommandPaths = [onPath, pinned].filter(
    (command): command is string => command !== undefined,
  );
  return managedCommandOrder === "desktop-first"
    ? [...installedDesktop, ...packageCommandPaths]
    : [...packageCommandPaths, ...installedDesktop];
}

/**
 * Managed candidates when Codex is the one installed on this computer and the
 * first-use download is not registered: a codex on PATH (meeting the minimum)
 * first, then the bundled platform package when this build has it, with the
 * desktop app where it was before. With none of them, the turn fails with the
 * sentence the Codex row in Settings shows.
 */
async function resolveInstalledCommandCandidates(params: {
  pluginRoot: string;
  platform: NodeJS.Platform;
  managedCommandOrder: CodexManagedCommandOrder;
  installed: ManagedCodexInstalled;
  pathExists: (filePath: string, platform: NodeJS.Platform) => Promise<boolean>;
  bundledReady: (launcher: string, platform: NodeJS.Platform) => boolean;
}): Promise<string[]> {
  const { platform, managedCommandOrder, installed } = params;
  const packageOnly = managedCommandOrder === "package-only";
  const installedDesktop: string[] = [];
  for (const command of packageOnly
    ? []
    : resolveMacOSDesktopCodexAppServerCommandCandidates(platform)) {
    if (await params.pathExists(command, platform)) {
      installedDesktop.push(command);
    }
  }
  const onPath = packageOnly ? undefined : (await installed.findPathCommand())?.command;
  const launcher = resolveManagedCodexPackageEntrypoint(params.pluginRoot);
  const bundled = launcher && params.bundledReady(launcher, platform) ? launcher : undefined;
  const packageCommandPaths = [onPath, bundled].filter(
    (command): command is string => command !== undefined,
  );
  if (packageCommandPaths.length === 0 && installedDesktop.length === 0) {
    throw new CodexNotInstalledError();
  }
  return managedCommandOrder === "desktop-first"
    ? [...installedDesktop, ...packageCommandPaths]
    : [...packageCommandPaths, ...installedDesktop];
}

function resolveManagedCodexAppServerCommandCandidates(
  pluginRoot: string,
  platform: NodeJS.Platform,
  managedCommandOrder: CodexManagedCommandOrder,
): string[] {
  const packageCommand = resolveManagedCodexPackageEntrypoint(pluginRoot);
  const packageCommandPaths = packageCommand ? [packageCommand] : [];
  if (managedCommandOrder === "package-only") {
    return packageCommandPaths;
  }
  const desktopCommandPaths = resolveMacOSDesktopCodexAppServerCommandCandidates(platform);
  // Ordinary turns must honor the pinned package version. Computer Use opts
  // into the desktop app owner because its macOS TCC permissions live there.
  return managedCommandOrder === "desktop-first"
    ? [...desktopCommandPaths, ...packageCommandPaths]
    : [...packageCommandPaths, ...desktopCommandPaths];
}

export function resolveManagedCodexPackageEntrypoint(pluginRoot: string): string | undefined {
  try {
    // Use the pinned package's official launcher on every OS. It owns platform
    // selection, manager environment markers, signal forwarding, and exit status.
    return createRequire(path.join(pluginRoot, "package.json")).resolve(
      `${MANAGED_CODEX_APP_SERVER_PACKAGE}/bin/codex.js`,
    );
  } catch {
    return undefined;
  }
}

async function commandPathExists(filePath: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    await access(filePath, platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}
