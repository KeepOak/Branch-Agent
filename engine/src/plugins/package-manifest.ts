import { isRecord } from "@branch/normalization-core/record-coerce";
import { normalizeOptionalString } from "../../packages/normalization-core/src/string-coerce.js";
import { MANIFEST_KEY } from "../compat/legacy-names.js";
import type {
  BranchPackageManifest,
  PackageExtensionResolution,
  PackageManifest,
} from "./package-manifest.types.js";

export type * from "./package-manifest.types.js";

export const DEFAULT_PLUGIN_ENTRY_CANDIDATES = [
  "index.ts",
  "index.js",
  "index.mjs",
  "index.cjs",
] as const;

export function getPackageManifestMetadata(
  manifest: PackageManifest | undefined,
): BranchPackageManifest | undefined {
  return manifest?.[MANIFEST_KEY];
}

/** Package authoring metadata names source; the runtime manifest names only built assets. */
export function controlUiSource(packageManifest: Record<string, unknown>): string | undefined {
  const source = isRecord(packageManifest.branch)
    ? packageManifest.branch.controlUi
    : undefined;
  if (source === undefined) {
    return undefined;
  }
  if (typeof source !== "string" || !source.trim()) {
    throw new Error("package.json branch.controlUi must name a browser source entrypoint.");
  }
  return source;
}

export function resolvePackageExtensionEntries(
  manifest: PackageManifest | undefined,
): PackageExtensionResolution {
  const rawBranch = manifest?.[MANIFEST_KEY] as unknown;
  if (rawBranch === undefined || rawBranch === null) {
    return { status: "missing", entries: [] };
  }
  if (!isRecord(rawBranch)) {
    return {
      status: "invalid",
      entries: [],
      error: "package.json branch must be an object",
    };
  }
  const raw = rawBranch.extensions;
  if (raw === undefined || raw === null) {
    return { status: "missing", entries: [] };
  }
  if (!Array.isArray(raw)) {
    return {
      status: "invalid",
      entries: [],
      error: "package.json branch.extensions must be an array",
    };
  }
  const entries: string[] = [];
  for (const [index, entry] of raw.entries()) {
    const normalized = normalizeOptionalString(entry);
    if (!normalized) {
      return {
        status: "invalid",
        entries: [],
        error: `package.json branch.extensions[${index}] must be a non-empty string`,
      };
    }
    entries.push(normalized);
  }
  if (entries.length === 0) {
    return { status: "empty", entries: [] };
  }
  return { status: "ok", entries };
}
