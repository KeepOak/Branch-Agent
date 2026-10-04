import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { resolveStateDir } from "../../config/state-dir.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { SkillBundle } from "../types.js";

const log = createSubsystemLogger("skills");
type BundleSnapshot = { signature: number; bundles: ReadonlyMap<string, SkillBundle> };
const snapshots = new Map<string, BundleSnapshot>();

function compareSourceNames(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function resolveSkillBundlesDir(): string {
  return path.join(resolveStateDir(), "skill-bundles");
}

/** Mirrors the source Unicode word-character slug, without channel publication limits. */
export function slugifySkillBundleName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[ _]/gu, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/-{2,}/gu, "-")
    .replace(/^-|-$/gu, "");
}

function bundleFiles(directory: string): string[] {
  try {
    const names = fs.readdirSync(directory);
    return [".yaml", ".yml"].flatMap((extension) =>
      names
        .filter((name) => name.endsWith(extension))
        .toSorted(compareSourceNames)
        .map((name) => path.join(directory, name)),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("Could not list skill bundles", { directory, error: String(error) });
    }
    return [];
  }
}

function bundleSignature(directory: string, files: string[]): number {
  let signature = 0;
  for (const file of [directory, ...files]) {
    try {
      signature = Math.max(signature, fs.statSync(file).mtimeMs);
    } catch {
      /* Gone file. */
    }
  }
  return signature;
}

function parseBundle(file: string): SkillBundle | undefined {
  try {
    const data: unknown = parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/u, ""), {
      maxAliasCount: -1,
    });
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Bundle is not a mapping");
    }
    const record = data as Record<string, unknown>;
    const name = String(record.name || path.basename(file, path.extname(file))).trim();
    const skills = Array.isArray(record.skills)
      ? record.skills
          .map(String)
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
    const slug = slugifySkillBundleName(name);
    if (!slug || skills.length === 0) {
      throw new Error("Bundle needs a name and nonempty skills list");
    }
    return Object.freeze({
      name,
      slug,
      skills: Object.freeze(skills),
      sourceFilePath: file,
      description:
        String(record.description || "").trim() || `Load ${skills.length} skills as a bundle`,
      instruction: String(record.instruction || "").trim(),
    });
  } catch (error) {
    log.warn("Skipping invalid skill bundle", { file, error: String(error) });
    return undefined;
  }
}

export function scanSkillBundles(
  directory = resolveSkillBundlesDir(),
): ReadonlyMap<string, SkillBundle> {
  const root = path.resolve(directory);
  const files = bundleFiles(root);
  const bundles = new Map<string, SkillBundle>();
  for (const file of files) {
    const bundle = parseBundle(file);
    if (!bundle) {
      continue;
    }
    const key = `/${bundle.slug}`;
    if (bundles.has(key)) {
      log.warn("Duplicate skill bundle slug; keeping first", { key, file });
    } else {
      bundles.set(key, bundle);
    }
  }
  snapshots.set(root, { signature: bundleSignature(root, files), bundles });
  return new Map(bundles);
}

export function getSkillBundles(
  directory = resolveSkillBundlesDir(),
): ReadonlyMap<string, SkillBundle> {
  const root = path.resolve(directory);
  const previous = snapshots.get(root);
  if (!previous?.bundles.size || previous.signature !== bundleSignature(root, bundleFiles(root))) {
    return scanSkillBundles(root);
  }
  return new Map(previous.bundles);
}

export function getSkillBundle(
  name: string,
  directory = resolveSkillBundlesDir(),
): SkillBundle | undefined {
  return getSkillBundles(directory).get(`/${slugifySkillBundleName(name.replace(/^\//u, ""))}`);
}

export function listSkillBundles(directory = resolveSkillBundlesDir()): SkillBundle[] {
  return [...getSkillBundles(directory).values()].toSorted((left, right) =>
    compareSourceNames(left.slug, right.slug),
  );
}

export function reloadSkillBundles(directory = resolveSkillBundlesDir()) {
  const before = snapshots.get(path.resolve(directory))?.bundles ?? new Map<string, SkillBundle>();
  const after = scanSkillBundles(directory);
  const names = (
    snapshot: ReadonlyMap<string, SkillBundle>,
    other: ReadonlyMap<string, SkillBundle>,
  ) =>
    [...snapshot.keys()]
      .filter((key) => !other.has(key))
      .toSorted(compareSourceNames)
      .map((key) => ({
        name: key.slice(1),
        description: snapshot.get(key)!.description,
      }));
  return {
    added: names(after, before),
    removed: names(before, after),
    unchanged: [...after.keys()]
      .filter((key) => before.has(key))
      .toSorted(compareSourceNames)
      .map((key) => key.slice(1)),
    total: after.size,
  };
}
