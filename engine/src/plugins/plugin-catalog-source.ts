import path from "node:path";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { normalizeOptionalString } from "@branch/normalization-core/string-coerce";
import { normalizeStringEntries } from "@branch/normalization-core/string-normalization";
import type { MANIFEST_KEY } from "../compat/legacy-names.js";
import { resolveConfigDir } from "../utils.js";
import type { BranchPackageManifest } from "./manifest.js";

export type ExternalPluginCatalogEntry = {
  name?: string;
  version?: string;
  description?: string;
} & Partial<Record<typeof MANIFEST_KEY, BranchPackageManifest>>;

export function parseExternalPluginCatalogEntries(raw: unknown): ExternalPluginCatalogEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : isRecord(raw)
      ? (raw.entries ?? raw.packages ?? raw.plugins)
      : undefined;
  return Array.isArray(list)
    ? list.filter((entry): entry is ExternalPluginCatalogEntry => isRecord(entry))
    : [];
}

export function resolveExternalPluginCatalogPaths(options: {
  catalogPaths?: string[];
  env?: NodeJS.ProcessEnv;
}): string[] {
  if (options.catalogPaths?.length) {
    return normalizeStringEntries(options.catalogPaths);
  }
  const env = options.env ?? process.env;
  for (const key of ["BRANCH_PLUGIN_CATALOG_PATHS", "BRANCH_MPM_CATALOG_PATHS"]) {
    const raw = normalizeOptionalString(env[key]);
    if (raw) {
      return normalizeStringEntries(
        raw.split(/[;,]/g).flatMap((chunk) => chunk.split(path.delimiter)),
      );
    }
  }
  const configDir = resolveConfigDir(env);
  return ["mpm/plugins.json", "mpm/catalog.json", "plugins/catalog.json"].map((relativePath) =>
    path.join(configDir, relativePath),
  );
}
