#!/usr/bin/env node
/**
 * Packaging smoke for Private #1090: the shipped engine must expose the
 * llama-cpp plugin so no-key-default can fall back when Ollama/LM Studio
 * are absent. Pass ENGINE_ROOT (unpacked engine dir) or PLUGIN_IDS_JSON
 * (JSON array of loaded plugin ids from a real gateway). Never clones.
 *
 * Exit 0 when llama-cpp is present; 1 with a one-line reason otherwise.
 */
import { readdir, readFile, access } from "node:fs/promises";
import { join } from "node:path";

const REQUIRED = "llama-cpp";

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

const ids =
  (await fromEnvList()) ??
  (process.env.ENGINE_ROOT
    ? await fromEngineRoot(process.env.ENGINE_ROOT)
    : null);

if (!ids) {
  console.error(
    "check-packaged-no-key-plugin: set ENGINE_ROOT or PLUGIN_IDS_JSON",
  );
  process.exit(1);
}

if (!ids.includes(REQUIRED)) {
  console.error(
    `check-packaged-no-key-plugin: missing required plugin "${REQUIRED}" (have: ${ids.sort().join(", ") || "(none)"})`,
  );
  process.exit(1);
}

console.log(`check-packaged-no-key-plugin: ok (${REQUIRED} present)`);
