#!/usr/bin/env node
/**
 * Packaging smoke for Private #1090 / FreeModelSetup: the shipped engine must
 * expose the llama-cpp plugin so no-key-default can fall back when Ollama/LM
 * Studio are absent.
 *
 * Modes (first match wins):
 * - PLUGIN_IDS_JSON: JSON array of loaded plugin ids
 * - ENGINE_ROOT: read each extensions/<id>/branch.plugin.json under that tree
 * - PACKAGE_JSON or default engine/package.json: fail if required plugin is
 *   pack-excluded via !dist/extensions/<id>/** in the `files` field
 *
 * Exit 0 when llama-cpp is present / not excluded; 1 with a one-line reason.
 */
import { readdir, readFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED = "llama-cpp";
export const EXCLUDE_RE = /^!dist\/extensions\/([^/]+)\/\*\*$/u;

export function excludedExtensionIds(files) {
  const out = new Set();
  for (const entry of files ?? []) {
    if (typeof entry !== "string") continue;
    const match = EXCLUDE_RE.exec(entry);
    if (match?.[1]) out.add(match[1]);
  }
  return out;
}

export function evaluatePackageFiles(files, required = REQUIRED) {
  const excluded = excludedExtensionIds(files);
  if (excluded.has(required)) {
    return {
      ok: false,
      message: `check-packaged-no-key-plugin: package.json files excludes required plugin "${required}" (!dist/extensions/${required}/**); remove that exclude so FreeModelSetup can load it`,
    };
  }
  return {
    ok: true,
    message: `check-packaged-no-key-plugin: ok (${required} not pack-excluded)`,
  };
}

async function fromEnvList() {
  const raw = process.env.PLUGIN_IDS_JSON;
  if (!raw) return null;
  const ids = JSON.parse(raw);
  if (!Array.isArray(ids)) throw new Error("PLUGIN_IDS_JSON must be a JSON array");
  return ids.map(String);
}

async function fromEngineRoot(root) {
  const extensions = join(root, "extensions");
  await access(extensions);
  const entries = await readdir(extensions, { withFileTypes: true });
  const ids = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const manifest = join(extensions, ent.name, "branch.plugin.json");
    try {
      const body = JSON.parse(await readFile(manifest, "utf8"));
      if (body?.id) ids.push(String(body.id));
    } catch {
      // skip non-plugin dirs
    }
  }
  return ids;
}

async function checkPackageJson(path) {
  const body = JSON.parse(await readFile(path, "utf8"));
  return evaluatePackageFiles(body.files ?? []);
}

async function main() {
  const ids =
    (await fromEnvList()) ??
    (process.env.ENGINE_ROOT
      ? await fromEngineRoot(process.env.ENGINE_ROOT)
      : null);

  if (ids) {
    if (!ids.includes(REQUIRED)) {
      console.error(
        `check-packaged-no-key-plugin: missing required plugin "${REQUIRED}" (have: ${ids.sort().join(", ") || "(none)"})`,
      );
      process.exit(1);
    }
    console.log(`check-packaged-no-key-plugin: ok (${REQUIRED} present)`);
    return;
  }

  const packagePath =
    process.env.PACKAGE_JSON ||
    join(dirname(fileURLToPath(import.meta.url)), "..", "engine", "package.json");
  const result = await checkPackageJson(packagePath);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(result.message);
}

await main();
