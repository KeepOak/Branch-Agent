// Shared frontmatter helpers parse Markdown frontmatter blocks and body text.
import { asOptionalObjectRecord } from "@branch/normalization-core/record-coerce";
import {
  normalizeOptionalLowercaseString,
  readStringValue,
} from "@branch/normalization-core/string-coerce";
import { normalizeCsvOrLooseStringList } from "@branch/normalization-core/string-normalization";
import JSON5 from "json5";
import { LEGACY_MANIFEST_KEYS, MANIFEST_KEY } from "../compat/legacy-names.js";
import { parseBooleanValue } from "../utils/boolean.js";
import { parseJsonWithJson5Fallback } from "../utils/parse-json-compat.js";

/** Reads a frontmatter field only when it is represented as a string value. */
export function getFrontmatterString(
  frontmatter: Record<string, unknown>,
  key: string,
): string | undefined {
  return readStringValue(frontmatter[key]);
}

/** Parses boolean frontmatter strings while preserving the caller's default for missing values. */
export function parseFrontmatterBool(value: string | undefined, fallback: boolean): boolean {
  const parsed = parseBooleanValue(value);
  return parsed === undefined ? fallback : parsed;
}

/** Parses the JSON5 Branch Agent manifest block embedded inside a string frontmatter field. */
export function resolveBranchManifestBlock(params: {
  frontmatter: Record<string, unknown>;
  key?: string;
}): Record<string, unknown> | undefined {
  const raw = getFrontmatterString(params.frontmatter, params.key ?? "metadata");
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = asOptionalObjectRecord(parseJsonWithJson5Fallback(raw, JSON5));
    if (!parsed) {
      return undefined;
    }

    const manifestKeys = [MANIFEST_KEY, ...LEGACY_MANIFEST_KEYS];
    // Prefer the current manifest key, but still read legacy names for existing skill/hook files.
    for (const key of manifestKeys) {
      const candidate = asOptionalObjectRecord(parsed[key]);
      if (candidate) {
        return candidate;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

type BranchManifestRequires = {
  /** All binaries that must be available. */
  bins: string[];
  /** Alternative binaries where any one match is enough. */
  anyBins: string[];
  /** Environment variables required by the entry. */
  env: string[];
  /** Config paths required by the entry. */
  config: string[];
};

/** Extracts normalized runtime requirement lists from a Branch Agent manifest block. */
export function resolveBranchManifestRequires(
  metadataObj: Record<string, unknown>,
): BranchManifestRequires | undefined {
  const requiresRaw = asOptionalObjectRecord(metadataObj.requires);
  if (!requiresRaw) {
    return undefined;
  }
  return {
    bins: normalizeCsvOrLooseStringList(requiresRaw.bins),
    anyBins: normalizeCsvOrLooseStringList(requiresRaw.anyBins),
    env: normalizeCsvOrLooseStringList(requiresRaw.env),
    config: normalizeCsvOrLooseStringList(requiresRaw.config),
  };
}

/** Parses manifest install entries with a caller-owned parser and drops unsupported specs. */
export function resolveBranchManifestInstall<T>(
  metadataObj: Record<string, unknown>,
  parseInstallSpec: (input: unknown) => T | undefined,
): T[] {
  const installRaw = Array.isArray(metadataObj.install) ? (metadataObj.install as unknown[]) : [];
  return installRaw
    .map((entry) => parseInstallSpec(entry))
    .filter((entry): entry is T => Boolean(entry));
}

/** Extracts normalized OS allowlist entries from a Branch Agent manifest block. */
export function resolveBranchManifestOs(metadataObj: Record<string, unknown>): string[] {
  return normalizeCsvOrLooseStringList(metadataObj.os);
}

type ParsedBranchManifestInstallBase = {
  /** Original install entry for caller-specific parsing. */
  raw: Record<string, unknown>;
  /** Normalized install kind accepted by the caller. */
  kind: string;
  /** Optional stable package/tool id from the manifest entry. */
  id?: string;
  /** Optional human-facing package/tool label. */
  label?: string;
  /** Optional binaries expected after installation. */
  bins?: string[];
};

/** Parses kind/type plus common install fields shared by package-manager install specs. */
export function parseBranchManifestInstallBase(
  input: unknown,
  allowedKinds: readonly string[],
): ParsedBranchManifestInstallBase | undefined {
  const raw = asOptionalObjectRecord(input);
  if (!raw) {
    return undefined;
  }
  const kindRaw =
    typeof raw.kind === "string" ? raw.kind : typeof raw.type === "string" ? raw.type : "";
  const kind = normalizeOptionalLowercaseString(kindRaw) ?? "";
  if (!allowedKinds.includes(kind)) {
    return undefined;
  }

  const spec: ParsedBranchManifestInstallBase = {
    raw,
    kind,
  };
  if (typeof raw.id === "string") {
    spec.id = raw.id;
  }
  if (typeof raw.label === "string") {
    spec.label = raw.label;
  }
  const bins = normalizeCsvOrLooseStringList(raw.bins);
  if (bins.length > 0) {
    spec.bins = bins;
  }
  return spec;
}

/** Copies optional common install fields onto a caller-specific install spec object. */
export function applyBranchManifestInstallCommonFields<
  T extends { id?: string; label?: string; bins?: string[] },
>(spec: T, parsed: Pick<ParsedBranchManifestInstallBase, "id" | "label" | "bins">): T {
  if (parsed.id) {
    spec.id = parsed.id;
  }
  if (parsed.label) {
    spec.label = parsed.label;
  }
  if (parsed.bins) {
    spec.bins = parsed.bins;
  }
  return spec;
}
