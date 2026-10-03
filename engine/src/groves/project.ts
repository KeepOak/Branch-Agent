import { lstat, mkdir, readdir, realpath, rmdir, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { coerceErrorMessage } from "@branch/normalization-core/error-coercion";
import { asOptionalRecord } from "@branch/normalization-core/record-coerce";
import { root as fsSafeRoot } from "../infra/fs-safe.js";
import { readGroveManifestFile } from "./reader.js";
import { isCanonicalClawHubPackageName, portableGrovePathKey } from "./schema-portability.js";
import type { ClawDiagnostic, GroveReadResult } from "./types.js";

export const GROVE_PROJECT_RESULT_SCHEMA_VERSION = "branch.groveProject.v1" as const;

const MAX_PACKAGE_JSON_BYTES = 256 * 1024;
const MAX_PROJECT_ENTRIES = 4096;
const AGENT_ID_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;

type GroveProjectPackageJson = {
  name: string;
  version: string;
  type?: string;
  branch: { grove: "GROVE.md" };
};

type GroveProjectValidationResult =
  | {
      ok: true;
      root: string;
      packageJson: GroveProjectPackageJson;
      grove: Extract<GroveReadResult, { ok: true }>;
      excludedPaths: string[];
      diagnostics: ClawDiagnostic[];
    }
  | { ok: false; root: string; diagnostics: ClawDiagnostic[] };

export class GroveProjectError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "GroveProjectError";
  }
}

function diagnostic(code: string, path: string, message: string): ClawDiagnostic {
  return { level: "error", code, phase: "policy", path, message };
}

function defaultSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/g, "")
    .slice(0, 64);
  return slug || "my-grove";
}

function displayName(agentId: string): string {
  return agentId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

async function pathState(path: string): Promise<"missing" | "empty-directory" | "occupied"> {
  const entry = await lstat(path).catch(() => undefined);
  if (!entry) {
    return "missing";
  }
  if (!entry.isDirectory()) {
    return "occupied";
  }
  return (await readdir(path)).length === 0 ? "empty-directory" : "occupied";
}

async function isFile(path: string): Promise<boolean> {
  return lstat(path)
    .then((entry) => entry.isFile())
    .catch(() => false);
}

async function isConfinedManifestFile(root: string): Promise<boolean> {
  const manifestPath = resolve(root, "GROVE.md");
  const entry = await lstat(manifestPath).catch(() => undefined);
  if (entry?.isFile()) {
    return true;
  }
  if (!entry?.isSymbolicLink()) {
    return false;
  }
  const [rootReal, targetReal] = await Promise.all([
    realpath(root).catch(() => undefined),
    realpath(manifestPath).catch(() => undefined),
  ]);
  if (!rootReal || !targetReal) {
    return false;
  }
  const targetRelative = relative(rootReal, targetReal);
  if (
    targetRelative === "" ||
    targetRelative === ".." ||
    targetRelative.startsWith(`..${sep}`) ||
    isAbsolute(targetRelative) ||
    isExcludedProjectSource(targetRelative)
  ) {
    return false;
  }
  return lstat(targetReal)
    .then((target) => target.isFile())
    .catch(() => false);
}

async function discoverGroveProjectRoot(projectPath: string): Promise<string> {
  const input = resolve(projectPath);
  const inputStat = await lstat(input).catch(() => undefined);
  if (!inputStat) {
    throw new GroveProjectError(
      "project_not_found",
      `Could not resolve Grove project path ${JSON.stringify(input)}.`,
    );
  }
  let current = inputStat.isDirectory() ? input : dirname(input);
  const roots: string[] = [];
  const filesystemRoot = parse(current).root;
  while (true) {
    if (
      (await isFile(resolve(current, "package.json"))) &&
      (await isConfinedManifestFile(current))
    ) {
      roots.push(await realpath(current));
    }
    if (current === filesystemRoot) {
      break;
    }
    current = dirname(current);
  }
  if (roots.length === 0) {
    throw new GroveProjectError(
      "project_not_found",
      `No Grove project containing package.json and GROVE.md was found from ${JSON.stringify(input)}.`,
    );
  }
  if (roots.length > 1) {
    throw new GroveProjectError(
      "ambiguous_project_root",
      `Multiple Grove project roots contain ${JSON.stringify(input)}: ${roots.join(", ")}.`,
    );
  }
  return roots[0] as string;
}

function projectPathKey(value: string, caseInsensitive: boolean): string {
  const normalized = value.normalize("NFC");
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

function isExcludedProjectSource(value: string): boolean {
  return portableGrovePathKey(value)
    .split("/")
    .some((segment) => segment === ".git" || segment === "node_modules");
}

async function isCaseInsensitiveProjectRoot(root: string): Promise<boolean> {
  const [canonical, folded] = await Promise.all([
    lstat(resolve(root, "GROVE.md")).catch(() => undefined),
    lstat(resolve(root, "grove.md")).catch(() => undefined),
  ]);
  return Boolean(
    canonical && folded && canonical.dev === folded.dev && canonical.ino === folded.ino,
  );
}

async function collectExcludedPaths(root: string, selectedPaths: Set<string>): Promise<string[]> {
  const excluded: string[] = [];
  const caseInsensitive = await isCaseInsensitiveProjectRoot(root);
  const selectedPathKeys = new Set(
    [...selectedPaths].map((path) => projectPathKey(path, caseInsensitive)),
  );
  let entryCount = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(resolve(root, directory), { withFileTypes: true });
    for (const entry of entries) {
      entryCount += 1;
      if (entryCount > MAX_PROJECT_ENTRIES) {
        throw new GroveProjectError(
          "project_too_many_entries",
          `Grove projects may contain at most ${MAX_PROJECT_ENTRIES} entries outside excluded dependency and source-control trees.`,
        );
      }
      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") {
          excluded.push(`${path}/`);
        } else {
          await visit(path);
        }
      } else if (!selectedPathKeys.has(projectPathKey(path, caseInsensitive))) {
        excluded.push(path);
      }
    }
  };
  await visit("");
  return excluded.toSorted((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
}

export async function createGroveProject(
  projectPath: string,
  options: { name?: string; agentId?: string } = {},
): Promise<{ root: string; packageJson: GroveProjectPackageJson; filesWritten: string[] }> {
  const root = resolve(projectPath);
  const initialState = await pathState(root);
  if (initialState === "occupied") {
    throw new GroveProjectError(
      "project_target_not_empty",
      `Grove project target ${JSON.stringify(root)} must be absent or empty.`,
    );
  }

  const agentId = options.agentId ?? defaultSlug(basename(root));
  if (!AGENT_ID_PATTERN.test(agentId)) {
    throw new GroveProjectError(
      "invalid_agent_id",
      `Agent id ${JSON.stringify(agentId)} must match ${AGENT_ID_PATTERN}.`,
    );
  }
  const name = options.name ?? agentId;
  if (!isCanonicalClawHubPackageName(name)) {
    throw new GroveProjectError(
      "invalid_package_name",
      `Package name ${JSON.stringify(name)} must be a canonical Seedbank package name.`,
    );
  }

  const packageJson: GroveProjectPackageJson = {
    name,
    version: "0.1.0",
    branch: { grove: "GROVE.md" },
  };
  const groveMarkdown = [
    "---",
    "schemaVersion: 1",
    "agent:",
    `  id: ${JSON.stringify(agentId)}`,
    `  name: ${JSON.stringify(displayName(agentId))}`,
    "---",
    `You are ${displayName(agentId)}, a purpose-built Branch Agent agent.`,
    "",
  ].join("\n");

  const packageJsonPath = resolve(root, "package.json");
  const groveMarkdownPath = resolve(root, "GROVE.md");
  const createdPaths: string[] = [];
  await mkdir(root, { recursive: true });
  try {
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    createdPaths.push(packageJsonPath);
    await writeFile(groveMarkdownPath, groveMarkdown, { encoding: "utf8", flag: "wx" });
    createdPaths.push(groveMarkdownPath);
  } catch (error) {
    await Promise.allSettled(createdPaths.map((path) => unlink(path)));
    if (initialState === "missing") {
      await rmdir(root).catch(() => undefined);
    }
    throw error;
  }
  return { root, packageJson, filesWritten: ["package.json", "GROVE.md"] };
}

export async function validateGroveProject(
  projectPath: string,
): Promise<GroveProjectValidationResult> {
  let root = resolve(projectPath);
  const failure = (code: string, path: string, message: string): GroveProjectValidationResult => ({
    ok: false,
    root,
    diagnostics: [diagnostic(code, path, message)],
  });
  try {
    root = await discoverGroveProjectRoot(projectPath);
  } catch (error) {
    return failure(
      error instanceof GroveProjectError ? error.code : "project_discovery_failed",
      "$",
      coerceErrorMessage(error),
    );
  }
  let packageValue: unknown;
  try {
    const sourceRoot = await fsSafeRoot(root);
    const read = await sourceRoot.read("package.json", {
      hardlinks: "reject",
      maxBytes: MAX_PACKAGE_JSON_BYTES,
      nonBlockingRead: true,
      symlinks: "reject",
    });
    packageValue = JSON.parse(read.buffer.toString("utf8"));
  } catch (error) {
    return failure(
      "invalid_project_package",
      "package.json",
      `Could not read a safe project package.json: ${(error as Error).message}`,
    );
  }

  const record = asOptionalRecord(packageValue);
  const branch = asOptionalRecord(record?.branch);
  const scripts = record?.scripts;
  const diagnostics: ClawDiagnostic[] = [];
  if (branch?.grove !== "GROVE.md") {
    diagnostics.push(
      diagnostic(
        "project_manifest_must_be_grove_markdown",
        "package.json.branch.grove",
        'A Grove project must set branch.grove to "GROVE.md".',
      ),
    );
  }
  if (
    scripts !== undefined &&
    (typeof scripts !== "object" ||
      scripts === null ||
      Array.isArray(scripts) ||
      Object.keys(scripts).length > 0)
  ) {
    diagnostics.push(
      diagnostic(
        "project_scripts_forbidden",
        "package.json.scripts",
        "Grove projects cannot declare package scripts or lifecycle hooks.",
      ),
    );
  }
  if (diagnostics.length > 0) {
    return { ok: false, root, diagnostics };
  }

  const grove = await readGroveManifestFile(root);
  if (!grove.ok) {
    return { ok: false, root, diagnostics: grove.diagnostics };
  }
  const excludedSource = [
    ...(grove.snapshot.branchProfile
      ? [
          {
            path: grove.snapshot.branchProfile.sourcePath,
            diagnosticPath: "$.metadata.branch.config",
          },
        ]
      : []),
    ...grove.snapshot.workspaceSources.map((source) => ({
      path: source.sourcePath,
      diagnosticPath: "$.workspace",
    })),
  ].find((source) => isExcludedProjectSource(source.path));
  if (excludedSource) {
    return failure(
      "project_excluded_source",
      excludedSource.diagnosticPath,
      `Selected project source ${JSON.stringify(excludedSource.path)} cannot come from .git or node_modules.`,
    );
  }
  const reservedPackageSource = grove.snapshot.workspaceSources.find(
    (source) => source.sourcePath.normalize("NFC").toLowerCase() === "package.json",
  );
  if (reservedPackageSource) {
    return failure(
      "project_invalid",
      "$.workspace.files",
      `Workspace source ${JSON.stringify(reservedPackageSource.sourcePath)} collides with generated package metadata.`,
    );
  }
  const selectedPathList = [
    "package.json",
    "GROVE.md",
    ...(grove.packageBootstrap ? ["BOOTSTRAP.md"] : []),
    ...(grove.snapshot.branchProfile ? [grove.snapshot.branchProfile.sourcePath] : []),
    ...grove.snapshot.workspaceSources.map((source) => source.sourcePath),
  ];
  const portableSelectedPaths = new Map<string, string>();
  for (const path of selectedPathList) {
    const key = portableGrovePathKey(path);
    const existing = portableSelectedPaths.get(key);
    if (existing && existing !== path) {
      return failure(
        "project_path_collision",
        "$",
        `Selected project paths ${JSON.stringify(existing)} and ${JSON.stringify(path)} collide on portable filesystems.`,
      );
    }
    portableSelectedPaths.set(key, path);
  }
  const selectedPaths = new Set(selectedPathList);
  let excludedPaths: string[];
  try {
    excludedPaths = await collectExcludedPaths(root, selectedPaths);
  } catch (error) {
    return failure(
      error instanceof GroveProjectError ? error.code : "project_enumeration_failed",
      "$",
      coerceErrorMessage(error),
    );
  }
  return {
    ok: true,
    root,
    packageJson: {
      name: grove.source.name,
      version: grove.source.version,
      ...(typeof record?.type === "string" ? { type: record.type } : {}),
      branch: { grove: "GROVE.md" },
    },
    grove,
    excludedPaths,
    diagnostics: grove.diagnostics,
  };
}
