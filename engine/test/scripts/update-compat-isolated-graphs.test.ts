import { execFileSync } from "node:child_process";
import fsSync from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  recordUpdateCompatibilityRelease,
  writeUpdateCompatibilityChunks,
  type UpdateCompatibilityInventory,
  type UpdateCompatibilityRelease,
} from "../../scripts/lib/update-compat-chunks.mts";
import { createScriptTestHarness } from "./test-helpers.js";

const { createTempDir } = createScriptTestHarness();
const integrity = `sha512-${Buffer.alloc(64).toString("base64")}`;

function write(root: string, relative: string, contents: string): void {
  const file = path.join(root, relative);
  fsSync.mkdirSync(path.dirname(file), { recursive: true });
  fsSync.writeFileSync(file, contents);
}

function recordFixture(): UpdateCompatibilityInventory & {
  releases: [UpdateCompatibilityRelease];
} {
  const root = createTempDir("update-compat-release-");
  write(root, "package.json", JSON.stringify({ name: "branch", version: "2026.9.1" }));
  write(
    root,
    "dist/build-info.json",
    JSON.stringify({ version: "2026.9.1", buildId: "fixture", commit: "0".repeat(40) }),
  );
  write(
    root,
    "dist/command.js",
    [
      "//#region src/cli/update-cli/update-command-service-command.ts",
      'export async function restart() { return (await import("./service-abcdefgh.js")).runner(); }',
      'export async function recover() { const { mode: selected } = await import("./service-abcdefgh.js"); return selected(); }',
    ].join("\n"),
  );
  write(
    root,
    "dist/service-abcdefgh.js",
    'export { r as runner, m as mode } from "./implementation-12345678.js";',
  );
  write(
    root,
    "dist/implementation-12345678.js",
    [
      "//#region src/cli/update-cli/runner.ts",
      'function resolveRunner() { return "old"; }',
      "//#region src/cli/update-cli/recovery.ts",
      'function resolveMode() { return "old"; }',
      "export { resolveRunner as r, resolveMode as m };",
    ].join("\n"),
  );
  return {
    schemaVersion: 1,
    releases: [recordUpdateCompatibilityRelease({ packageDir: root, integrity })],
  };
}

function candidate(root: string): void {
  write(root, "src/cli/update-cli/recovery.ts", 'import { resolveMode } from "./mode.js";');
  write(root, "src/cli/update-cli/mode.ts", 'export function resolveMode() { return "npm"; }');
  write(
    root,
    "dist/current.mjs",
    [
      "//#region src/cli/update-cli/runner.ts",
      'function resolveRunner() { return "node"; }',
      "//#region src/cli/update-cli/mode.ts",
      'function resolveMode() { return "npm"; }',
      "export { resolveRunner as x, resolveMode as y };",
    ].join("\n"),
  );
}

describe("update compatibility isolated entry graphs", () => {
  it.each([
    ["graft", "present"],
    ["graft", "missing"],
  ])(
    "excludes the isolated %s graph when the runtime binding is %s",
    (directory, runtime) => {
      const inventory = recordFixture();
      // macOS temp dirs sit behind the /var -> /private/var symlink; use the real path for both
      // imports so the bridge and the declaration resolve to one module instance.
      const root = fsSync.realpathSync(createTempDir("update-compat-isolated-graph-"));
      candidate(root);
      const current = path.join(root, "dist/current.mjs");
      write(root, `dist/${directory}/inspect.mjs`, fsSync.readFileSync(current, "utf8"));
      const options = { distDir: path.join(root, "dist"), sourceDir: root, inventory };
      if (runtime === "missing") {
        fsSync.unlinkSync(current);
        expect(() => writeUpdateCompatibilityChunks(options)).toThrow(
          /no equivalent current export/,
        );
        expect(fsSync.existsSync(path.join(root, "dist/service-abcdefgh.js"))).toBe(false);
        return;
      }
      writeUpdateCompatibilityChunks(options);
      const bridgeUrl = pathToFileURL(path.join(root, "dist/service-abcdefgh.js")).href;
      const declarationUrl = pathToFileURL(current).href;
      // Vitest's module runner can load the direct import separately from the bridge's native ESM
      // re-export. Check identity in Node's actual module graph instead.
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import assert from "node:assert/strict";
const bridge = await import(${JSON.stringify(bridgeUrl)});
const declaration = await import(${JSON.stringify(declarationUrl)});
assert.strictEqual(bridge.mode, declaration.y);
assert.strictEqual(bridge.runner, declaration.x);`,
        ],
        { windowsHide: true },
      );
    },
  );
});
