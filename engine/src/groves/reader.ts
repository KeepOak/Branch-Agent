import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { assertNoSymlinkParents } from "@openclaw/fs-safe/advanced";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES } from "../agents/workspace-bootstrap-read.js";
import { FsSafeError, root as fsSafeRoot, type OpenResult } from "../infra/fs-safe.js";
import { readGroveBranchProfile } from "./branch-profile.js";
import { isCanonicalClawHubPackageName, isExactSemVer } from "./schema-portability.js";
import { groveManifestWorkspaceConflictsWithPath, parseGroveManifest } from "./schema.js";
import {
  MAX_GROVE_MANIFEST_BYTES,
  MAX_MANAGED_FILE_BYTES,
  MAX_MANAGED_WORKSPACE_BYTES,
} from "./source-limits.js";
import type {
  ClawDiagnostic,
  GroveManifest,
  GroveReadResult,
  GroveSourceIdentity,
  GroveWorkspaceSourceSnapshot,
} from "./types.js";
import { parseGroveYaml } from "./yaml-document.js";

type PackageJson = {
  name: string;
  version: string;
  branch: { grove: string };
};

type ResolvedGroveSource = Omit<GroveSourceIdentity, "integrity" | "integrityKind" | "byteLength"> & {
  packageJsonRaw?: Buffer;
  manifestFormatPath: string;
};

const GROVE_MARKDOWN_FILENAME = "GROVE.md";
const MAX_GROVE_PACKAGE_JSON_BYTES = 256 * 1024;

async function readBoundedFile(path: string, maxBytes: number): Promise<Buffer> {
  const fileRoot = await fsSafeRoot(dirname(path));
  const read = await fileRoot.read(basename(path), {
    hardlinks: "reject",
    maxBytes,
    nonBlockingRead: true,
    symlinks: "reject",
  });
  return read.buffer;
}

function fileDiagnostic(code: string, message: string, path = "$"): ClawDiagnostic {
  return { level: "error", code, phase: "parse", path, message };
}

function fileFailure(code: string, message: string, path = "$") {
  return { ok: false as const, diagnostics: [fileDiagnostic(code, message, path)] };
}

function isContained(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function updateSnapshotHash(
  hash: ReturnType<typeof createHash>,
  label: string,
  bytes: Buffer,
): void {
  hash.update(`${Buffer.byteLength(label, "utf8")}:${label}:${bytes.byteLength}:`, "utf8");
  hash.update(bytes);
}

function workspaceSourceDiagnostic(error: unknown, sourcePath: string): ClawDiagnostic {
  if (error instanceof FsSafeError && error.code === "too-large") {
    return fileDiagnostic(
      "workspace_source_too_large",
      `Workspace source ${JSON.stringify(sourcePath)} exceeds ${MAX_MANAGED_FILE_BYTES} bytes.`,
      "$.workspace",
    );
  }
  if (
    (error instanceof FsSafeError &&
      (error.code === "symlink" || error.code === "hardlink" || error.code === "path-mismatch")) ||
    (error instanceof Error && error.message.includes("symlinked directory"))
  ) {
    return fileDiagnostic(
      "workspace_source_unsafe",
      `Workspace source ${JSON.stringify(sourcePath)} must be a regular, non-symlinked, non-hardlinked file.`,
      "$.workspace",
    );
  }
  return fileDiagnostic(
    "workspace_source_invalid",
    `Workspace source ${JSON.stringify(sourcePath)} must resolve inside the Grove source.`,
    "$.workspace",
  );
}

async function buildDevelopmentSnapshot(params: {
  source: ResolvedGroveSource;
  manifest: GroveManifest;
  manifestRaw: Buffer;
  branchProfile?: { path: string; raw: Buffer };
}): Promise<
  | {
      ok: true;
      integrity: string;
      byteLength: number;
      manifest: { byteLength: number; digest: string };
      branchProfile?: { sourcePath: string; byteLength: number; digest: string };
      workspaceSources: GroveWorkspaceSourceSnapshot[];
      packageBootstrap?: GroveWorkspaceSourceSnapshot;
    }
  | { ok: false; diagnostics: ClawDiagnostic[] }
> {
  const hash = createHash("sha256");
  let byteLength = 0;
  const add = (label: string, bytes: Buffer) => {
    updateSnapshotHash(hash, label, bytes);
    byteLength += bytes.byteLength;
  };
  const snapshotFile = (bytes: Buffer) => ({
    byteLength: bytes.byteLength,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  });
  const manifest = snapshotFile(params.manifestRaw);
  const branchProfile = params.branchProfile
    ? {
        sourcePath: params.branchProfile.path.replaceAll("\\", "/"),
        ...snapshotFile(params.branchProfile.raw),
      }
    : undefined;
  add("canonical-source", Buffer.from(params.source.manifestPath, "utf8"));
  add("manifest", params.manifestRaw);
  if (params.branchProfile) {
    add(`profile:${params.branchProfile.path.replaceAll("\\", "/")}`, params.branchProfile.raw);
  }

  if (params.source.kind === "package") {
    const packageJson = params.source.packageJsonRaw;
    if (!packageJson) {
      return fileFailure("package_read_failed", "Could not snapshot package.json.");
    }
    add("package.json", packageJson);
  }

  const sourceRoot = await fsSafeRoot(params.source.packageRoot);
  let packageBootstrap: GroveWorkspaceSourceSnapshot | undefined;
  if (await sourceRoot.exists("BOOTSTRAP.md")) {
    try {
      const read = await sourceRoot.read("BOOTSTRAP.md", {
        hardlinks: "reject",
        maxBytes: MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES,
        nonBlockingRead: true,
        symlinks: "reject",
      });
      const text = new TextDecoder("utf-8", { fatal: true }).decode(read.buffer);
      if (text.trim().length === 0) {
        return fileFailure(
          "package_bootstrap_empty",
          "Package-root BOOTSTRAP.md must contain first-run instructions.",
          "$.bootstrap",
        );
      }
      const digest = `sha256:${createHash("sha256").update(read.buffer).digest("hex")}`;
      add("bootstrap:BOOTSTRAP.md", read.buffer);
      packageBootstrap = {
        sourcePath: "BOOTSTRAP.md",
        realPath: read.realPath,
        byteLength: read.buffer.byteLength,
        digest,
      };
    } catch (error) {
      const tooLarge = error instanceof FsSafeError && error.code === "too-large";
      return fileFailure(
        tooLarge ? "package_bootstrap_too_large" : "package_bootstrap_invalid",
        tooLarge
          ? `Package-root BOOTSTRAP.md exceeds ${MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES} bytes.`
          : `Package-root BOOTSTRAP.md must be a safe UTF-8 regular file: ${(error as Error).message}`,
        "$.bootstrap",
      );
    }
  }

  const declaredSources = [
    ...Object.values(params.manifest.workspace.bootstrapFiles)
      .filter((entry): entry is { source: string } => entry !== undefined)
      .map((entry) => entry.source),
    ...params.manifest.workspace.files.map((entry) => entry.source),
  ].toSorted((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));

  const openedSources: Array<{ sourcePath: string; opened: OpenResult }> = [];
  const workspaceSources: GroveWorkspaceSourceSnapshot[] = [];
  try {
    let workspaceByteLength = 0;
    for (const sourcePath of declaredSources) {
      try {
        await assertNoSymlinkParents({
          rootDir: params.source.packageRoot,
          targetPath: resolve(params.source.packageRoot, sourcePath),
          allowMissing: false,
          messagePrefix: "Workspace source",
        });
        const opened = await sourceRoot.open(sourcePath, {
          hardlinks: "reject",
          symlinks: "reject",
        });
        if (opened.stat.size > MAX_MANAGED_FILE_BYTES) {
          await opened[Symbol.asyncDispose]();
          throw new FsSafeError(
            "too-large",
            `file exceeds limit of ${MAX_MANAGED_FILE_BYTES} bytes (got ${opened.stat.size})`,
          );
        }
        workspaceByteLength += opened.stat.size;
        openedSources.push({ sourcePath, opened });
      } catch (error) {
        return { ok: false, diagnostics: [workspaceSourceDiagnostic(error, sourcePath)] };
      }
    }

    if (workspaceByteLength > MAX_MANAGED_WORKSPACE_BYTES) {
      return fileFailure(
        "workspace_sources_too_large",
        `Workspace sources exceed ${MAX_MANAGED_WORKSPACE_BYTES} aggregate bytes.`,
        "$.workspace",
      );
    }

    let readWorkspaceByteLength = 0;
    for (const { sourcePath, opened } of openedSources) {
      const bytes = await opened.handle.readFile();
      if (bytes.byteLength > MAX_MANAGED_FILE_BYTES) {
        return {
          ok: false,
          diagnostics: [
            workspaceSourceDiagnostic(
              new FsSafeError("too-large", "workspace source grew while reading"),
              sourcePath,
            ),
          ],
        };
      }
      readWorkspaceByteLength += bytes.byteLength;
      if (readWorkspaceByteLength > MAX_MANAGED_WORKSPACE_BYTES) {
        return fileFailure(
          "workspace_sources_too_large",
          `Workspace sources exceed ${MAX_MANAGED_WORKSPACE_BYTES} aggregate bytes.`,
          "$.workspace",
        );
      }
      const normalizedSourcePath = sourcePath.replaceAll("\\", "/");
      const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      add(`workspace:${sourcePath.replaceAll("\\", "/")}`, bytes);
      workspaceSources.push({
        sourcePath: normalizedSourcePath,
        realPath: opened.realPath,
        byteLength: bytes.byteLength,
        digest,
      });
    }
  } finally {
    await Promise.all(openedSources.map(({ opened }) => opened[Symbol.asyncDispose]()));
  }

  return {
    ok: true,
    integrity: `sha256:${hash.digest("hex")}`,
    byteLength,
    manifest,
    ...(branchProfile ? { branchProfile } : {}),
    workspaceSources,
    ...(packageBootstrap ? { packageBootstrap } : {}),
  };
}

function parsePackageJson(value: unknown): PackageJson | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const record = value;
  const branch = record.branch;
  if (!isRecord(branch)) {
    return undefined;
  }
  const { grove } = branch;
  if (
    typeof record.name !== "string" ||
    !isCanonicalClawHubPackageName(record.name) ||
    typeof record.version !== "string" ||
    !isExactSemVer(record.version) ||
    typeof grove !== "string" ||
    grove.trim() === ""
  ) {
    return undefined;
  }
  return { name: record.name, version: record.version, branch: { grove } };
}

export function parseGroveMarkdown(
  raw: Buffer,
  path: string,
): { ok: true; value: unknown; body: Buffer } | { ok: false; diagnostics: ClawDiagnostic[] } {
  const markdown =
    raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf
      ? raw.subarray(3)
      : raw;
  const byteText = markdown.toString("latin1");
  const match = byteText.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return fileFailure(
      "missing_grove_frontmatter",
      `${path} must start with a YAML frontmatter block delimited by --- lines.`,
    );
  }
  const frontmatterBytes = Buffer.from(match[1] ?? "", "latin1");
  const body = markdown.subarray(match[0].length);
  let frontmatter: string;
  try {
    frontmatter = new TextDecoder("utf-8", { fatal: true }).decode(frontmatterBytes);
    new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return fileFailure("invalid_grove_markdown_utf8", `${path} must contain valid UTF-8.`);
  }
  const parsed = parseGroveYaml(frontmatter, path, "frontmatter");
  return parsed.ok ? { ...parsed, body } : parsed;
}

function parseGroveManifestDocument(
  raw: Buffer,
  path: string,
): { ok: true; value: unknown; body?: Buffer } | { ok: false; diagnostics: ClawDiagnostic[] } {
  if (basename(path).toLowerCase() === GROVE_MARKDOWN_FILENAME.toLowerCase()) {
    return parseGroveMarkdown(raw, path);
  }
  try {
    return { ok: true, value: JSON.parse(raw.toString("utf8")) };
  } catch (error) {
    return fileFailure("invalid_json", `Could not parse ${path}: ${(error as Error).message}`);
  }
}

async function readClawDocument(
  path: string,
  code: string,
  maxBytes: number,
  manifestFormatPath = path,
): Promise<
  | { ok: true; raw: Buffer; value: unknown; body?: Buffer }
  | { ok: false; diagnostics: ClawDiagnostic[] }
> {
  let raw: Buffer;
  try {
    raw = await readBoundedFile(path, maxBytes);
  } catch (error) {
    const tooLarge =
      error instanceof RangeError || (error instanceof FsSafeError && error.code === "too-large");
    return fileFailure(
      tooLarge ? `${code}_too_large` : code,
      tooLarge
        ? `${path} exceeds ${maxBytes} bytes.`
        : `Could not read ${path}: ${(error as Error).message}`,
    );
  }
  const parsed = parseGroveManifestDocument(raw, manifestFormatPath);
  return parsed.ok ? { ...parsed, raw } : parsed;
}

async function resolvePackageSource(
  packageRoot: string,
): Promise<
  { ok: true; source: ResolvedGroveSource } | { ok: false; diagnostics: ClawDiagnostic[] }
> {
  const packageRootReal = await realpath(packageRoot).catch(() => undefined);
  if (!packageRootReal) {
    return fileFailure("package_read_failed", `Could not resolve ${packageRoot}.`);
  }
  const packageJsonPath = resolve(packageRootReal, "package.json");
  const packageJsonResult = await readClawDocument(
    packageJsonPath,
    "package_read_failed",
    MAX_GROVE_PACKAGE_JSON_BYTES,
  );
  if (!packageJsonResult.ok) {
    return packageJsonResult;
  }
  const packageJson = parsePackageJson(packageJsonResult.value);
  if (!packageJson) {
    return fileFailure(
      "invalid_package_metadata",
      "package.json must declare non-empty name, version, and branch.grove fields.",
    );
  }
  if (isAbsolute(packageJson.branch.grove)) {
    return fileFailure("manifest_escapes_package", "branch.grove must be package-relative.");
  }
  const declaredManifestPath = resolve(packageRootReal, packageJson.branch.grove);
  const manifestPath = await realpath(declaredManifestPath).catch(() => undefined);
  if (!manifestPath || !isContained(packageRootReal, manifestPath)) {
    return fileFailure(
      "manifest_escapes_package",
      "The declared Grove manifest must resolve inside its package root.",
    );
  }
  return {
    ok: true,
    source: {
      kind: "package",
      name: packageJson.name,
      version: packageJson.version,
      packageRoot: packageRootReal,
      manifestPath,
      packageJsonRaw: packageJsonResult.raw,
      manifestFormatPath: declaredManifestPath,
    },
  };
}

async function resolveSource(
  path: string,
): Promise<
  { ok: true; source: ResolvedGroveSource } | { ok: false; diagnostics: ClawDiagnostic[] }
> {
  const inputPath = resolve(path);
  const inputStat = await stat(inputPath).catch(() => undefined);
  if (!inputStat) {
    return fileFailure("read_failed", `Could not resolve Grove source ${inputPath}.`);
  }
  if (inputStat.isDirectory()) {
    const sourceRoot = await fsSafeRoot(inputPath);
    if (
      !(await sourceRoot.exists("package.json")) &&
      (await sourceRoot.exists(GROVE_MARKDOWN_FILENAME))
    ) {
      return resolveSource(resolve(inputPath, GROVE_MARKDOWN_FILENAME));
    }
    return resolvePackageSource(inputPath);
  }
  if (!inputStat.isFile()) {
    return fileFailure("unsupported_source", "Grove source must be a file or directory.");
  }

  const manifestPath = await realpath(inputPath);
  const packageRoot = await realpath(dirname(manifestPath));
  return {
    ok: true,
    source: {
      kind: "development",
      name: `local:${basename(manifestPath).replace(/\.json$/i, "")}`,
      version: "0.0.0-development",
      packageRoot,
      manifestPath,
      manifestFormatPath: inputPath,
    },
  };
}

export async function readGroveManifestFile(
  path: string,
  options: {
    allowLegacyDynamicToolProfile?: boolean;
    authorizeLegacyDynamicToolProfile?: (params: {
      manifest: GroveManifest;
      source: Pick<
        GroveSourceIdentity,
        "kind" | "name" | "version" | "packageRoot" | "manifestPath"
      >;
    }) => boolean | Promise<boolean>;
  } = {},
): Promise<GroveReadResult> {
  const sourceResult = await resolveSource(path);
  if (!sourceResult.ok) {
    return sourceResult;
  }
  const manifestResult = await readClawDocument(
    sourceResult.source.manifestPath,
    "read_failed",
    MAX_GROVE_MANIFEST_BYTES,
    sourceResult.source.manifestFormatPath,
  );
  if (!manifestResult.ok) {
    return manifestResult;
  }
  const parsed = parseGroveManifest(manifestResult.value);
  if (!parsed.ok) {
    return parsed;
  }
  const hasMarkdownBody =
    manifestResult.body !== undefined && manifestResult.body.toString("utf8").trim().length > 0;
  if (hasMarkdownBody && groveManifestWorkspaceConflictsWithPath(parsed.manifest, "SOUL.md")) {
    return fileFailure(
      "grove_body_soul_conflict",
      "GROVE.md body content and an explicit SOUL.md workspace declaration cannot both be present.",
      "$.workspace",
    );
  }
  const allowLegacyDynamicToolProfile =
    options.allowLegacyDynamicToolProfile === true ||
    (options.authorizeLegacyDynamicToolProfile
      ? await options.authorizeLegacyDynamicToolProfile({
          manifest: parsed.manifest,
          source: {
            kind: sourceResult.source.kind,
            name: sourceResult.source.name,
            version: sourceResult.source.version,
            packageRoot: sourceResult.source.packageRoot,
            manifestPath: sourceResult.source.manifestPath,
          },
        })
      : false);
  const profile = await readGroveBranchProfile({
    packageRoot: sourceResult.source.packageRoot,
    metadata: parsed.manifest.metadata,
    ...(allowLegacyDynamicToolProfile ? { allowLegacyDynamicToolProfile: true } : {}),
  });
  if (!profile.ok) {
    return profile;
  }
  const snapshot = await buildDevelopmentSnapshot({
    source: sourceResult.source,
    manifest: parsed.manifest,
    manifestRaw: manifestResult.raw,
    ...(profile.raw && profile.path
      ? { branchProfile: { path: profile.path, raw: profile.raw } }
      : {}),
  });
  if (!snapshot.ok) {
    return snapshot;
  }
  const resolvedSource = sourceResult.source;
  const source: GroveSourceIdentity = {
    kind: resolvedSource.kind,
    name: resolvedSource.name,
    version: resolvedSource.version,
    packageRoot: resolvedSource.packageRoot,
    manifestPath: resolvedSource.manifestPath,
    integrityKind: "development-snapshot",
    integrity: snapshot.integrity,
    byteLength: snapshot.byteLength,
  };
  return {
    ok: true,
    manifest: parsed.manifest,
    ...(hasMarkdownBody ? { groveMarkdownBody: manifestResult.body } : {}),
    ...(snapshot.packageBootstrap ? { packageBootstrap: snapshot.packageBootstrap } : {}),
    ...(profile.profile ? { branchProfile: profile.profile } : {}),
    ...(profile.legacyProfile ? { legacyBranchProfile: profile.legacyProfile } : {}),
    source,
    snapshot: {
      manifest: snapshot.manifest,
      ...(snapshot.branchProfile ? { branchProfile: snapshot.branchProfile } : {}),
      workspaceSources: snapshot.workspaceSources,
      ...(snapshot.packageBootstrap ? { packageBootstrap: snapshot.packageBootstrap } : {}),
    },
    diagnostics: [...parsed.diagnostics, ...(profile.diagnostics ?? [])],
  };
}
