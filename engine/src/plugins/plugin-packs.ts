// NousResearch/hermes-agent@18d125cc1bd9d0e26188ab49bb325427d5945fa2:hermes_cli/plugin_packs.py (atlas TOOLS-0027)
// Plugin packs: declarative, shareable plugin sets. Every plugin entry must pin an exact
// 40-character commit SHA in `ref`; tags and branch names are rejected with an error naming the entry.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { fetchWithSsrFGuard } from "../infra/net/fetch-guard.js";

const EXACT_SHA_RE = /^[0-9a-fA-F]{40}$/;
// Secret-shaped keys are refused in config seeds and stripped from exports; packs declare secrets
// through each plugin's own required environment, which prompts at install time.
const SECRET_KEY_RE = /(token|secret|passw(or)?d|api[_-]?key|private[_-]?key|credential|auth)/i;
// Entry keys a pack may never set (consent state; allow_* gates are also refused).
const RESERVED_ENTRY_KEYS = new Set(["granted_capabilities", "capabilities_consent"]);
const MAX_PACK_BYTES = 1024 * 1024; // a pack is a small manifest, not a payload
const FETCH_TIMEOUT_MS = 15_000;

/** Pack parse, validation or fetch failure. */
export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackError";
  }
}

/** One pinned plugin in a pack. */
export type PackPluginEntry = {
  /** Exact 40-character commit SHA, lowercased. */
  ref: string;
  /** Bare community-index name... */
  name?: string;
  /** ...or owner/repo shorthand or git URL. */
  repo?: string;
  /** Path within the repo. */
  subdir?: string;
};

/** A parsed, validated pack manifest. */
export type PluginPack = {
  name: string;
  description: string;
  author: string;
  version: string;
  plugins: PackPluginEntry[];
  /** Plugin id -> non-secret, non-reserved settings seed. */
  config: Record<string, Record<string, unknown>>;
  /** Skill ids. Parsed and listed, not installed. */
  skills: string[];
};

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function repr(value: unknown): string {
  return value === undefined || value === null ? "None" : JSON.stringify(value);
}

/** Display label for an entry: `repo/subdir` for repo entries, else the name or repo. */
export function packEntryDisplay(entry: PackPluginEntry): string {
  const base = entry.name ?? entry.repo ?? "?";
  return entry.repo && entry.subdir ? `${base}/${entry.subdir}` : base;
}

/** Install identifier; undefined for bare names (resolved through the plugin catalog). */
export function packEntryInstallIdentifier(entry: PackPluginEntry): string | undefined {
  if (!entry.repo) {
    return undefined;
  }
  return entry.subdir ? `${entry.repo}/${entry.subdir}` : entry.repo;
}

function entryLabel(item: unknown, index: number): string {
  if (isRecord(item)) {
    const label = item.name || item.repo;
    if (typeof label === "string" && label.trim()) {
      return `'${label.trim()}'`;
    }
  }
  return `#${index + 1}`;
}

function forbiddenKeyReason(key: string): "reserved" | "secret" | undefined {
  if (RESERVED_ENTRY_KEYS.has(key) || key.startsWith("allow_")) {
    return "reserved";
  }
  return SECRET_KEY_RE.test(key) ? "secret" : undefined;
}

/** `[dotted key, reason]` of the first forbidden key at any depth, else undefined. */
function firstForbiddenKey(
  value: unknown,
  prefix = "",
): [string, "reserved" | "secret"] | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = firstForbiddenKey(child, prefix);
      if (found) {
        return found;
      }
    }
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  for (const [key, child] of Object.entries(value)) {
    const reason = forbiddenKeyReason(key);
    if (reason) {
      return [`${prefix}${key}`, reason];
    }
    const found = firstForbiddenKey(child, `${prefix}${key}.`);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function isExportableLeaf(value: unknown): boolean {
  return (
    value === null ||
    ["string", "number", "boolean"].includes(typeof value) ||
    Array.isArray(value) ||
    isRecord(value)
  );
}

/** Copy of `value` with forbidden keys and non-YAML leaves removed at every depth. */
export function stripForbiddenKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripForbiddenKeys);
  }
  if (!isRecord(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, child]) => forbiddenKeyReason(key) === undefined && isExportableLeaf(child))
      .map(([key, child]) => [key, stripForbiddenKeys(child)]),
  );
}

/** Exportable plugin entry settings: reserved and secret-shaped keys stripped at every depth. */
export function sanitizedEntryConfig(entry: unknown): Rec {
  return isRecord(entry) ? (stripForbiddenKeys(entry) as Rec) : {};
}

/** Validate one plugin's config seed and return a copy; rejects reserved and secret-shaped keys. */
export function validateConfigSeed(pluginId: string, seed: unknown): Rec {
  if (!isRecord(seed)) {
    throw new PackError(
      `Pack config for plugin '${pluginId}' must be a mapping of plugins.entries.${pluginId} keys.`,
    );
  }
  for (const key of Object.keys(seed)) {
    if (!key.trim()) {
      throw new PackError(`Pack config for plugin '${pluginId}' has an invalid key: ${repr(key)}.`);
    }
  }
  const found = firstForbiddenKey(seed);
  if (found?.[1] === "reserved") {
    throw new PackError(
      `Pack config for plugin '${pluginId}' sets reserved key '${found[0]}': packs cannot pre-grant capabilities or trust gates. Capability consent happens interactively at install time.`,
    );
  }
  if (found) {
    throw new PackError(
      `Pack config for plugin '${pluginId}' sets secret-shaped key '${found[0]}': secrets never travel in packs. Declare the secret in the plugin's required environment instead; it is prompted at install.`,
    );
  }
  return { ...seed };
}

function parseEntryRepo(item: Rec): string | undefined {
  const repo = item.repo || item.source;
  if (typeof repo !== "string") {
    return undefined;
  }
  const stripped = repo.startsWith("github:") ? repo.slice("github:".length) : repo;
  return stripped.trim() || undefined;
}

function parseEntryName(item: Rec, label: string): string | undefined {
  const name = item.name;
  if (name !== undefined && name !== null && (typeof name !== "string" || !name.trim())) {
    throw new PackError(`Pack plugin entry ${label} has an invalid 'name'.`);
  }
  return typeof name === "string" ? name.trim() : undefined;
}

function parsePackEntry(item: unknown, label: string): PackPluginEntry {
  if (!isRecord(item)) {
    throw new PackError(`Pack plugin entry ${label} must be a mapping.`);
  }
  const name = parseEntryName(item, label);
  const repo = parseEntryRepo(item);
  if (!name && !repo) {
    throw new PackError(
      `Pack plugin entry ${label} needs either 'name' (community index) or 'repo' (owner/repo or git URL).`,
    );
  }
  const ref = item.ref || item.version;
  if (typeof ref !== "string" || !EXACT_SHA_RE.test(ref.trim())) {
    throw new PackError(
      `Pack plugin entry ${label} has ref ${repr(ref)}: refs must be exact 40-character commit SHAs (tags and branch names are rejected; pin the commit for reproducible installs).`,
    );
  }
  const subdir = item.subdir;
  const trimmedSubdir = typeof subdir === "string" ? subdir.replace(/^\/+|\/+$/g, "") : undefined;
  if (subdir !== undefined && subdir !== null && !trimmedSubdir) {
    throw new PackError(`Pack plugin entry ${label} has an invalid 'subdir'.`);
  }
  return {
    ref: ref.trim().toLowerCase(),
    ...(name ? { name } : {}),
    ...(repo ? { repo } : {}),
    ...(trimmedSubdir ? { subdir: trimmedSubdir } : {}),
  };
}

function parseYamlDocument(text: string, source: string): unknown {
  try {
    return parseYaml(text);
  } catch (error) {
    throw new PackError(`Pack ${source} is not valid YAML: ${String(error)}`, { cause: error });
  }
}

function parsePackConfig(raw: Rec, source: string): PluginPack["config"] {
  const configRaw = raw.config || {};
  if (!isRecord(configRaw)) {
    throw new PackError(`Pack ${source} 'config' must be a mapping of plugin id -> settings.`);
  }
  return Object.fromEntries(
    Object.entries(configRaw).map(([pluginId, seed]) => [
      pluginId,
      validateConfigSeed(pluginId, seed),
    ]),
  );
}

function parsePackSkills(raw: Rec, source: string): string[] {
  const skillsRaw = raw.skills || [];
  if (!Array.isArray(skillsRaw)) {
    throw new PackError(`Pack ${source} 'skills' must be a list of skill ids.`);
  }
  return skillsRaw.map((skill) => String(skill).trim()).filter(Boolean);
}

/** Parse and validate a pack YAML document. */
export function parsePack(text: string, source = "<pack>"): PluginPack {
  const raw = parseYamlDocument(text, source);
  if (!isRecord(raw)) {
    throw new PackError(`Pack ${source} must be a YAML mapping.`);
  }
  // Accept the nested form (pack: { name: ... }) as sugar.
  const meta = isRecord(raw.pack) ? raw.pack : raw;
  const name = meta.name;
  if (typeof name !== "string" || !name.trim()) {
    throw new PackError(`Pack ${source} is missing a 'name'.`);
  }
  const pluginsRaw = raw.plugins;
  if (!Array.isArray(pluginsRaw) || pluginsRaw.length === 0) {
    throw new PackError(`Pack ${source} must declare a non-empty 'plugins' list.`);
  }
  const plugins = pluginsRaw.map((item, index) => parsePackEntry(item, entryLabel(item, index)));
  const textField = (value: unknown) =>
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value || "")
      : "";
  return {
    name: name.trim(),
    description: textField(meta.description),
    author: textField(meta.author),
    version: textField(meta.version),
    plugins,
    config: parsePackConfig(raw, source),
    skills: parsePackSkills(raw, source),
  };
}

async function fetchPackText(url: string): Promise<string> {
  try {
    const { response, release } = await fetchWithSsrFGuard({
      url,
      requireHttps: true,
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    try {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } finally {
      await release();
    }
  } catch (error) {
    throw new PackError(`Could not fetch pack from ${url}: ${String(error)}`, { cause: error });
  }
}

function expandHome(input: string): string {
  return input === "~" || input.startsWith("~/") ? path.join(os.homedir(), input.slice(1)) : input;
}

async function readPackFile(input: string): Promise<string> {
  const filePath = expandHome(input);
  const stat = await fs.stat(filePath).catch(() => undefined);
  if (!stat?.isFile()) {
    throw new PackError(`Pack file not found: ${filePath}`);
  }
  if (stat.size > MAX_PACK_BYTES) {
    throw new PackError("Pack file exceeds the 1 MiB size limit.");
  }
  return (await fs.readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
}

/** Load a pack from a local file path or an `https://` URL. */
export async function loadPack(pathOrUrl: string): Promise<PluginPack> {
  if (pathOrUrl.startsWith("https://")) {
    const text = await fetchPackText(pathOrUrl);
    if (Buffer.byteLength(text, "utf8") > MAX_PACK_BYTES) {
      throw new PackError("Pack payload exceeds the 1 MiB size limit.");
    }
    return parsePack(text, pathOrUrl);
  }
  if (/^(?:http|file|ftp):\/\//.test(pathOrUrl)) {
    throw new PackError("Pack URLs must use https:// (or pass a local file path).");
  }
  const text = await readPackFile(pathOrUrl);
  return parsePack(text, expandHome(pathOrUrl));
}
