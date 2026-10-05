import { lstatSync, symlinkSync, unlinkSync, type Stats } from "node:fs";
// Links plugin peer packages for local development installs.
import fs from "node:fs/promises";
import path from "node:path";
import { asOptionalRecord } from "@branch/normalization-core/record-coerce";
import type { PluginInstallRecord } from "../config/types.plugins.js";
import { hasErrnoCode } from "../infra/errors.js";
import { resolveUserPath } from "../infra/home-dir.js";
import { readRootJsonObjectSync } from "../infra/json-files.js";
import { resolveBranchPackageRootSync } from "../infra/branch-root.js";
import { isPathInside } from "../infra/path-guards.js";
import { resolvePluginInstallDir } from "./install-paths.js";
import { listNpmPackageDirs } from "./npm-package-dirs.js";
import { safeRealpathSync } from "./path-safety.js";

type PluginPeerLinkLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

type RelinkManagedNpmRootResult = {
  checked: number;
  attempted: number;
  repaired: number;
  skipped: number;
};

export type BranchPeerLinkAuditIssue = {
  packageName: string;
  packageDir: string;
  reason: string;
};

type AuditManagedNpmRootResult = {
  checked: number;
  broken: number;
  issues: BranchPeerLinkAuditIssue[];
};

type BranchPeerLinkResult = "linked" | "skipped" | "unchanged";

type BranchHostDependency = {
  declaration: "peerDependencies" | "dependencies" | "optionalDependencies";
  spec: string;
};

type RegisteredBranchHostLinkResult = {
  checked: number;
  repaired: number;
  skipped: number;
  issues: BranchPeerLinkAuditIssue[];
};

/** Resolve the host declaration consistently for peer, direct, and optional dependencies. */
export function resolveBranchHostDependency(manifest: {
  dependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
}): BranchHostDependency | null {
  for (const declaration of ["peerDependencies", "optionalDependencies", "dependencies"] as const) {
    const spec = asOptionalRecord(manifest[declaration])?.branch;
    if (typeof spec === "string" && spec) {
      return { declaration, spec };
    }
  }
  return null;
}

async function readSafePackageManifest(
  packageDir: string,
): Promise<Record<string, unknown> | null> {
  const result = readRootJsonObjectSync({
    rootDir: packageDir,
    relativePath: "package.json",
    boundaryLabel: "installed plugin package directory",
  });
  if (!result.ok) {
    if (
      result.reason === "open" &&
      (result.failure.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
    ) {
      return null;
    }
    if (result.reason === "parse") {
      throw new SyntaxError(result.error);
    }
    if (result.reason === "open" && result.failure.error instanceof Error) {
      throw result.failure.error;
    }
    throw new Error(
      `Could not safely read package.json from ${packageDir}: ${
        result.reason === "open" ? result.failure.reason : result.error
      }`,
    );
  }
  return result.value;
}

async function readPackageBranchLinkDependencies(
  packageDir: string,
  onPackageReadError?: (error: unknown, packageDir: string) => void,
): Promise<Record<string, string> | undefined> {
  try {
    const manifest = await readSafePackageManifest(packageDir);
    const dependency = manifest ? resolveBranchHostDependency(manifest) : null;
    return dependency ? { branch: dependency.spec } : {};
  } catch (error) {
    if (!onPackageReadError) {
      throw error;
    }
    onPackageReadError(error, packageDir);
    return undefined;
  }
}

async function listManagedNpmRootPackageDirs(npmRoot: string): Promise<string[]> {
  const packageDirs = await listNpmPackageDirs(npmRoot, {
    includeEntry: (entry, scoped) => entry.isDirectory() && (scoped || !entry.name.startsWith(".")),
  });
  return packageDirs.toSorted((a, b) => a.localeCompare(b));
}

async function safeRealpath(filePath: string): Promise<string | null> {
  try {
    return await fs.realpath(filePath);
  } catch {
    return null;
  }
}

function managedPackageNameFromDir(params: { npmRoot: string; packageDir: string }): string {
  return path
    .relative(path.join(params.npmRoot, "node_modules"), params.packageDir)
    .split(path.sep)
    .join("/");
}

function auditBranchPeerDependency(params: {
  hostRoot: string;
  packageDir: string;
  npmRoot?: string;
  packageName?: string;
}): BranchPeerLinkAuditIssue | null {
  const packageName =
    params.packageName ??
    (params.npmRoot
      ? managedPackageNameFromDir({
          npmRoot: params.npmRoot,
          packageDir: params.packageDir,
        })
      : path.basename(params.packageDir));
  const issue = (reason: string): BranchPeerLinkAuditIssue => ({
    packageName,
    packageDir: params.packageDir,
    reason,
  });
  const nodeModulesDir = path.join(params.packageDir, "node_modules");
  try {
    const existing = lstatSync(nodeModulesDir);
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      return issue(`${nodeModulesDir} is not a real directory`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return issue(`missing ${path.join(nodeModulesDir, "branch")}`);
    }
    throw error;
  }

  const linkPath = path.join(nodeModulesDir, "branch");
  const currentTarget = safeRealpathSync(linkPath);
  if (!currentTarget) {
    return issue(`missing ${linkPath}`);
  }
  const expectedTarget = safeRealpathSync(params.hostRoot) ?? params.hostRoot;
  if (currentTarget !== expectedTarget) {
    return issue(`${linkPath} points to ${currentTarget} instead of ${expectedTarget}`);
  }
  return null;
}

export function auditBranchPeerDependencyLinkSync(params: {
  packageDir: string;
  packageName?: string;
}): BranchPeerLinkAuditIssue | null {
  const packageName = params.packageName ?? path.basename(params.packageDir);
  const hostRoot = resolveBranchPackageRootSync({
    argv1: process.argv[1],
    moduleUrl: import.meta.url,
    cwd: process.cwd(),
  });
  if (!hostRoot) {
    return {
      packageName,
      packageDir: params.packageDir,
      reason: "could not locate branch package root",
    };
  }
  return auditBranchPeerDependency({
    hostRoot,
    packageDir: params.packageDir,
    packageName,
  });
}

export async function auditBranchPeerDependencyLink(
  params: Parameters<typeof auditBranchPeerDependencyLinkSync>[0],
): Promise<BranchPeerLinkAuditIssue | null> {
  return auditBranchPeerDependencyLinkSync(params);
}

/** Audit the installed host only when the package actually declares a Branch Agent dependency. */
export async function auditDeclaredBranchHostDependency(params: {
  packageDir: string;
  packageName?: string;
}): Promise<BranchPeerLinkAuditIssue | null> {
  const dependencies = await readPackageBranchLinkDependencies(params.packageDir);
  if (!dependencies || !Object.hasOwn(dependencies, "branch")) {
    return null;
  }
  return await auditBranchPeerDependencyLink(params);
}

async function ensureRealNodeModulesDir(params: {
  installedDir: string;
  logger: PluginPeerLinkLogger;
  beforePersistentApply?: () => void;
  beforePersistentEffect?: () => void | Promise<void>;
}): Promise<string | null> {
  const nodeModulesDir = path.join(params.installedDir, "node_modules");
  let existing: Stats | undefined;
  try {
    existing = await fs.lstat(nodeModulesDir);
  } catch (error) {
    if (!hasErrnoCode(error, "ENOENT")) {
      throw error;
    }
  }
  if (!existing) {
    await params.beforePersistentEffect?.();
    params.beforePersistentApply?.();
    await fs.mkdir(nodeModulesDir, { recursive: true });
    existing = await fs.lstat(nodeModulesDir);
  }
  if (!existing.isDirectory() || existing.isSymbolicLink()) {
    params.logger.warn?.(
      `Skipping branch peerDependency link because ${nodeModulesDir} is not a real directory.`,
    );
    return null;
  }
  return nodeModulesDir;
}

async function linkBranchPeerDependency(params: {
  hostRoot: string;
  installedDir: string;
  logger: PluginPeerLinkLogger;
  beforePersistentApply?: () => void;
  beforePersistentEffect?: () => void | Promise<void>;
}): Promise<BranchPeerLinkResult> {
  const nodeModulesDir = await ensureRealNodeModulesDir(params);
  if (!nodeModulesDir) {
    return "skipped";
  }

  const linkPath = path.join(nodeModulesDir, "branch");
  const expectedTarget = (await safeRealpath(params.hostRoot)) ?? params.hostRoot;
  const currentTarget = await safeRealpath(linkPath);
  if (currentTarget === expectedTarget) {
    return "unchanged";
  }

  const warn = (error: unknown): "skipped" => {
    params.beforePersistentApply?.();
    params.logger.warn?.(`Failed to symlink peerDependency "branch": ${String(error)}`);
    return "skipped";
  };
  let existing: Stats | null;
  try {
    existing = await fs.lstat(linkPath).catch((error: unknown) => {
      if (hasErrnoCode(error, "ENOENT")) {
        return null;
      }
      throw error;
    });
    if (
      existing &&
      !existing.isSymbolicLink() &&
      (!existing.isDirectory() || (await readPackageName(linkPath)) !== "branch")
    ) {
      params.logger.warn?.(
        `Skipping branch peerDependency link because ${linkPath} already exists and is not a symlink.`,
      );
      return "skipped";
    }
  } catch (error) {
    return warn(error);
  }
  // Await the initiating owner's effect gate, then revalidate synchronous
  // mutation authority outside filesystem warning conversion before each effect.
  if (existing) {
    await params.beforePersistentEffect?.();
    params.beforePersistentApply?.();
    try {
      if (existing.isSymbolicLink()) {
        unlinkSync(linkPath);
      } else {
        await fs.rm(linkPath, { recursive: true, force: true });
      }
    } catch (error) {
      return warn(error);
    }
  }
  await params.beforePersistentEffect?.();
  params.beforePersistentApply?.();
  try {
    symlinkSync(params.hostRoot, linkPath, "junction");
    params.logger.info?.(`Linked peerDependency "branch" -> ${params.hostRoot}`);
    return "linked";
  } catch (error) {
    return warn(error);
  }
}

async function readPackageName(packageDir: string): Promise<string | undefined> {
  const manifest = await readSafePackageManifest(packageDir);
  return typeof manifest?.name === "string" ? manifest.name : undefined;
}

/**
 * Symlink the host branch package for plugins that declare it as a dependency.
 * Plugin package managers still own third-party dependencies; this only wires
 * the host SDK package into the plugin-local Node graph.
 */
export async function linkBranchPeerDependencies(params: {
  installedDir: string;
  peerDependencies: Record<string, string>;
  logger: PluginPeerLinkLogger;
  /** Explicit source setup uses its selected checkout instead of the running host. */
  hostRoot?: string;
  beforePersistentApply?: () => void;
  beforePersistentEffect?: () => void | Promise<void>;
}): Promise<{ repaired: number; skipped: number }> {
  if (!Object.keys(params.peerDependencies).includes("branch")) {
    return { repaired: 0, skipped: 0 };
  }

  const hostRoot =
    params.hostRoot ??
    resolveBranchPackageRootSync({
      argv1: process.argv[1],
      moduleUrl: import.meta.url,
      cwd: process.cwd(),
    });
  if (!hostRoot) {
    params.logger.warn?.(
      "Could not locate branch package root to symlink peerDependencies; plugin may fail to resolve branch at runtime.",
    );
    return { repaired: 0, skipped: 1 };
  }

  const result = await linkBranchPeerDependency({ ...params, hostRoot });
  return { repaired: result === "linked" ? 1 : 0, skipped: result === "skipped" ? 1 : 0 };
}

/**
 * Repair registered package installs named by the authoritative install ledger.
 * Local/path installs and symlink escapes remain developer-owned and are never mutated.
 */
export async function reconcileRegisteredBranchHostLinks(params: {
  installRecords: Record<string, PluginInstallRecord>;
  extensionsDir: string;
  env?: NodeJS.ProcessEnv;
  mode: "audit" | "repair";
  logger?: PluginPeerLinkLogger;
  onPackageReadError?: (error: unknown, packageDir: string) => void;
  beforePersistentApply?: () => void;
  beforePersistentEffect?: () => void | Promise<void>;
}): Promise<RegisteredBranchHostLinkResult> {
  const extensionsRoot = path.resolve(params.extensionsDir);
  const extensionsRootRealPath = await safeRealpath(extensionsRoot);
  if (!extensionsRootRealPath) {
    return { checked: 0, repaired: 0, skipped: 0, issues: [] };
  }

  let checked = 0;
  let repaired = 0;
  let skipped = 0;
  const issues: BranchPeerLinkAuditIssue[] = [];
  for (const [pluginId, record] of Object.entries(params.installRecords).toSorted(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (
      (record.source !== "npm" && record.source !== "clawhub" && record.source !== "archive") ||
      !record.installPath?.trim()
    ) {
      continue;
    }

    let packageDir: string;
    let expectedPackageDir: string;
    try {
      packageDir = path.resolve(resolveUserPath(record.installPath, params.env));
      expectedPackageDir = path.resolve(resolvePluginInstallDir(pluginId, extensionsRoot));
    } catch {
      continue;
    }
    if (packageDir !== expectedPackageDir) {
      continue;
    }

    const packageRealPath = await safeRealpath(packageDir);
    const expectedPackageRealPath = path.join(
      extensionsRootRealPath,
      path.relative(extensionsRoot, expectedPackageDir),
    );
    // Ledger paths cannot alias an outside directory or another developer-owned plugin in this root.
    if (
      !packageRealPath ||
      !isPathInside(extensionsRootRealPath, packageRealPath) ||
      packageRealPath !== expectedPackageRealPath
    ) {
      continue;
    }

    const dependencies = await readPackageBranchLinkDependencies(
      packageDir,
      params.onPackageReadError,
    );
    if (!dependencies) {
      skipped += 1;
      continue;
    }
    if (!Object.hasOwn(dependencies, "branch")) {
      continue;
    }
    checked += 1;

    const issue = await auditBranchPeerDependencyLink({
      packageDir,
      packageName: pluginId,
    });
    if (!issue) {
      continue;
    }
    issues.push(issue);
    if (params.mode !== "repair") {
      continue;
    }

    const result = await linkBranchPeerDependencies({
      installedDir: packageDir,
      peerDependencies: dependencies,
      logger: params.logger ?? {},
      beforePersistentApply: params.beforePersistentApply,
      beforePersistentEffect: params.beforePersistentEffect,
    });
    repaired += result.repaired;
    skipped += result.skipped;
  }
  return { checked, repaired, skipped, issues };
}

export async function relinkBranchPeerDependenciesInManagedNpmRoot(params: {
  npmRoot: string;
  beforePersistentApply?: () => void;
  logger: PluginPeerLinkLogger;
  onPackageReadError?: (error: unknown, packageDir: string) => void;
  beforePersistentEffect?: () => void | Promise<void>;
}): Promise<RelinkManagedNpmRootResult> {
  let checked = 0;
  let attempted = 0;
  let repaired = 0;
  let skipped = 0;
  for (const packageDir of await listManagedNpmRootPackageDirs(params.npmRoot)) {
    const branchLinkDependencies = await readPackageBranchLinkDependencies(
      packageDir,
      params.onPackageReadError,
    );
    if (!branchLinkDependencies) {
      skipped += 1;
      continue;
    }
    if (!Object.hasOwn(branchLinkDependencies, "branch")) {
      continue;
    }
    checked += 1;
    const result = await linkBranchPeerDependencies({
      installedDir: packageDir,
      peerDependencies: branchLinkDependencies,
      logger: params.logger,
      beforePersistentApply: params.beforePersistentApply,
      beforePersistentEffect: params.beforePersistentEffect,
    });
    attempted += 1;
    repaired += result.repaired;
    skipped += result.skipped;
  }
  return { checked, attempted, repaired, skipped };
}

export async function auditBranchPeerDependenciesInManagedNpmRoot(params: {
  npmRoot: string;
  onPackageReadError?: (error: unknown, packageDir: string) => void;
}): Promise<AuditManagedNpmRootResult> {
  const hostRoot = resolveBranchPackageRootSync({
    argv1: process.argv[1],
    moduleUrl: import.meta.url,
    cwd: process.cwd(),
  });
  if (!hostRoot) {
    return { checked: 0, broken: 0, issues: [] };
  }

  let checked = 0;
  const issues: BranchPeerLinkAuditIssue[] = [];
  for (const packageDir of await listManagedNpmRootPackageDirs(params.npmRoot)) {
    const branchLinkDependencies = await readPackageBranchLinkDependencies(
      packageDir,
      params.onPackageReadError,
    );
    if (!branchLinkDependencies || !Object.hasOwn(branchLinkDependencies, "branch")) {
      continue;
    }
    checked += 1;
    const issue = auditBranchPeerDependency({
      hostRoot,
      npmRoot: params.npmRoot,
      packageDir,
    });
    if (issue) {
      issues.push(issue);
    }
  }
  return { checked, broken: issues.length, issues };
}
