import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readRootJsonObjectSync } from "@openclaw/fs-safe/json";
import { isBunRuntime } from "../daemon/runtime-binary.js";

/** Resolve an explicit installed root, source sibling, or stable packaged worker path. */
export function resolveRuntimeWorkerUrl(params: {
  currentModuleUrl: string;
  sourceWorkerName: string;
  distWorkerPath: string;
  root?: string;
  /** Package-local output when the nearest dist belongs to this package. */
  package?: { name: string; distWorkerPath: string };
}): URL {
  if (params.root !== undefined) {
    return pathToFileURL(path.join(params.root, "dist", params.distWorkerPath));
  }
  const currentPath = fileURLToPath(params.currentModuleUrl);
  const normalized = currentPath.replaceAll(path.sep, "/");
  const distMarker = "/dist/";
  const distIndex = normalized.lastIndexOf(distMarker);
  if (distIndex >= 0) {
    const distRoot = currentPath.slice(0, distIndex + distMarker.length);
    let workerPath = params.distWorkerPath;
    if (params.package) {
      const packageRoot = path.resolve(distRoot, "..");
      const manifest = readRootJsonObjectSync({
        rootDir: packageRoot,
        relativePath: "package.json",
        boundaryLabel: "runtime worker package",
        rejectHardlinks: false,
      });
      if (!manifest.ok) {
        throw new Error(`Cannot resolve runtime worker package: ${packageRoot}/package.json`);
      }
      // Standalone plugins keep their own dist root, including shared build chunks.
      if (manifest.value.name === params.package.name) {
        workerPath = params.package.distWorkerPath;
      }
    }
    return pathToFileURL(path.join(distRoot, workerPath));
  }
  const extension = path.extname(currentPath) || ".js";
  return new URL(`./${params.sourceWorkerName}${extension}`, params.currentModuleUrl);
}

/**
 * Resolve a loader specifier such as "tsx" to a file URL. `import.meta.resolve` is missing when this module
 * is loaded through a CommonJS transform (tsx/esbuild rewrite `import.meta` to a plain object, which threw
 * "define_import_meta_default.resolve is not a function" in Doctor's Codex migration), so fall back to
 * createRequire, as runtime-worker-url.test.ts already does. tsx's "." and "./esm" exports are unconditional.
 */
export function resolveLoaderSpecifierUrl(
  specifier: string,
  meta: { resolve?: unknown; url?: unknown } = import.meta,
): string {
  if (typeof meta.resolve === "function") {
    return (meta.resolve as (value: string) => string)(specifier);
  }
  const base =
    typeof meta.url === "string" && meta.url
      ? meta.url
      : typeof __filename === "string"
        ? pathToFileURL(__filename).href
        : pathToFileURL(path.join(process.cwd(), "__branch_loader_base__.js")).href;
  return pathToFileURL(createRequire(base).resolve(specifier)).href;
}

function isBunTargetRuntime(execPath: string): boolean {
  // Current runtime metadata also identifies renamed binaries; foreign paths keep their own selection.
  return execPath === process.execPath ? Boolean(process.versions.bun) : isBunRuntime(execPath);
}

/** Disable implicit package installation in Branch-owned Bun processes. */
export function resolveRuntimeArgs(execPath = process.execPath): string[] {
  return isBunTargetRuntime(execPath) ? ["--no-install"] : [];
}

/** Whether a source TypeScript module needs Node's tsx loader; Bun runs TypeScript natively. */
export function runtimeNeedsTypeScriptLoader(modulePath: string, execPath = process.execPath) {
  return /\.[cm]?ts$/.test(modulePath) && !isBunTargetRuntime(execPath);
}

export function resolveRuntimeWorkerArgv(url: URL, execPath = process.execPath): string[] {
  const entry = fileURLToPath(url);
  // Resolve the preload here: Node resolves bare imports from the child cwd.
  return runtimeNeedsTypeScriptLoader(entry, execPath)
    ? ["--import", resolveLoaderSpecifierUrl("tsx"), entry]
    : [...resolveRuntimeArgs(execPath), entry];
}

/** Select the source Worker preload without feeding Node's TypeScript loader to Bun. */
export function resolveRuntimeWorkerThreadExecArgv(
  url: URL,
  execPath = process.execPath,
): string[] {
  return url.protocol === "file:" && runtimeNeedsTypeScriptLoader(fileURLToPath(url), execPath)
    ? ["--import", resolveLoaderSpecifierUrl("tsx/esm")]
    : [];
}
