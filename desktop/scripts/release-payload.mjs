import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const MiB = 1024 * 1024;

/**
 * Source maps and TypeScript declarations in production dependencies. No packaged runtime loads them:
 * the engine runs built JavaScript, and Node reads a source map only when one is asked for and present.
 */
export function isDevelopmentOnlyDependencyFile(path) {
  return path.startsWith("node_modules/") && /\.(?:map|d\.[cm]?ts)$/u.test(path);
}

/**
 * The Codex platform packages (@openai/codex-<os>-<arch>: codex, its code-mode and voice hosts, rg; ~318 MiB).
 * Releases ship only the small @openai/codex launcher; Codex turns use the Codex installed on the computer
 * (engine/extensions/codex/src/app-server/installed-codex.ts). Nothing is downloaded.
 */
export function isCodexPlatformPackageFile(path) {
  return /^node_modules\/(?:.+\/node_modules\/)?@openai\/codex-(?:darwin|linux|win32)-(?:arm64|x64)\//u.test(path);
}

/** Regular files under root, as forward-slash paths, sorted. Links are never followed. */
async function regularFiles(root, folder = "") {
  const result = [];
  const entries = (await readdir(join(root, folder), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    const path = folder ? `${folder}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await regularFiles(root, path));
    else if (entry.isFile()) result.push({ path, bytes: (await lstat(join(root, path))).size });
  }
  return result;
}

/** Remove dependency source maps and declarations from a production engine deployment. */
export async function pruneProductionDependencies(deployment) {
  let files = 0; let bytes = 0;
  for (const file of await regularFiles(deployment)) {
    if (!isDevelopmentOnlyDependencyFile(file.path)) continue;
    await rm(join(deployment, file.path));
    files += 1; bytes += file.bytes;
  }
  return { files, bytes };
}

/** Remove the Codex platform packages from a production engine deployment; the launcher stays. */
export async function pruneCodexPlatformPackages(deployment) {
  const packages = new Set(); let files = 0; let bytes = 0;
  for (const file of await regularFiles(deployment)) {
    if (!isCodexPlatformPackageFile(file.path)) continue;
    packages.add(file.path.match(/^(.*?@openai\/codex-[^/]+)\//u)[1]);
    files += 1; bytes += file.bytes;
  }
  for (const folder of packages) await rm(join(deployment, folder), { recursive: true, force: true });
  return { packages: [...packages].sort(), files, bytes };
}

/** Payload categories, biggest known items first; the first match owns a file. */
export const PAYLOAD_CATEGORIES = [
  ["Codex CLI binary", isCodexPlatformPackageFile],
  ["Computer use (cua-driver, @trycua)", path => /^cua-driver(?:\.exe)?$/u.test(path) || path.startsWith("node_modules/@trycua/")],
  ["Dependency source maps", path => isDevelopmentOnlyDependencyFile(path) && path.endsWith(".map")],
  ["Dependency declarations", path => isDevelopmentOnlyDependencyFile(path)],
  ["Other dependencies", path => path.startsWith("node_modules/")],
  ["Plugin private setup chunks", path => /^dist\/extensions\/[^/]+\/\.setup\//u.test(path)],
  ["Control UI", path => path.startsWith("dist/control-ui/")],
  ["Graft", path => path.startsWith("dist/graft/")],
  ["Other engine dist", path => path.startsWith("dist/")],
  ["Docs, skills and launchers", () => true],
];

/** Bytes per category, plus each bundled plugin's private setup chunks. */
export async function measurePayload(root) {
  const categories = Object.fromEntries(PAYLOAD_CATEGORIES.map(([name]) => [name, 0]));
  const setupChunks = {};
  let total = 0;
  for (const { path, bytes } of await regularFiles(root)) {
    total += bytes;
    categories[PAYLOAD_CATEGORIES.find(([, matches]) => matches(path))[0]] += bytes;
    const plugin = path.match(/^dist\/extensions\/([^/]+)\/\.setup\//u)?.[1];
    if (plugin) setupChunks[plugin] = (setupChunks[plugin] ?? 0) + bytes;
  }
  return { total, categories, setupChunks };
}

/**
 * The engine payload budget. Removed categories stay removed (Codex is the one the person installs). A bundled plugin's setup chunks stay small:
 * a relative import into engine source once copied the whole engine graph (67 MB) into one plugin.
 */
export const PAYLOAD_BUDGET = { removed: ["Codex CLI binary", "Dependency source maps", "Dependency declarations"], setupChunkBytes: 16 * MiB };

export function payloadBudgetProblems(payload, budget = PAYLOAD_BUDGET) {
  const problems = [];
  for (const name of budget.removed) {
    if (payload.categories[name] > 0) problems.push(`${name}: ${payload.categories[name]} bytes shipped; this category is removed from releases`);
  }
  for (const [plugin, bytes] of Object.entries(payload.setupChunks)) {
    if (bytes > budget.setupChunkBytes) {
      problems.push(`dist/extensions/${plugin}/.setup: ${bytes} bytes, over the ${budget.setupChunkBytes}-byte plugin setup budget; import engine code through branch/plugin-sdk`);
    }
  }
  return problems;
}

/** One markdown table, for the release log and size reviews. */
export function formatPayload(payload) {
  const mb = bytes => (bytes / MiB).toFixed(1);
  const rows = Object.entries(payload.categories).map(([name, bytes]) => `| ${name} | ${mb(bytes)} |`);
  return ["| Engine payload | MiB |", "|---|---:|", ...rows, `| Total | ${mb(payload.total)} |`].join("\n");
}
