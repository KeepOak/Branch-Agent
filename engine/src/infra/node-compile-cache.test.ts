import fs from "node:fs/promises";
import path from "node:path";
import { expectDefined } from "@branch/normalization-core";
import { afterEach, expect, it } from "vitest";
import {
  maintainBranchCompileCache,
  resolveBranchCompileCacheDirectory,
} from "../../node-compile-cache.mjs";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);
const MiB = 1024 * 1024;

it.each([
  ["another-app", "1000-100"],
  ["branch", "unowned"],
])("preserves unqualified cache directories: %s/%s", async (owner, marker) => {
  const root = tempDirs.make("branch-cache-unowned-");
  const version = path.join(root, owner, "2026.9.6");
  const sibling = path.join(version, "2000-100");
  await fs.mkdir(sibling, { recursive: true });
  await fs.writeFile(path.join(sibling, "bytecode"), "keep");
  await maintainBranchCompileCache(path.join(version, marker));
  expect(await fs.readdir(version)).toEqual(["2000-100"]);
  expect(await fs.readFile(path.join(sibling, "bytecode"), "utf8")).toBe("keep");
});

async function sparseFile(file: string, bytes: number) {
  const handle = await fs.open(file, "w");
  try {
    await handle.truncate(bytes);
  } finally {
    await handle.close();
  }
}

it("keeps inherited cache namespaces flat and retires superseded builds", async () => {
  const root = tempDirs.make("branch-cache-builds-");
  await fs.mkdir(path.join(root, "dist"));
  await fs.writeFile(path.join(root, "package.json"), '{"version":"2026.9.6"}');
  const base = path.join(root, "cache");
  let inherited = path.join(base, "branch", "2026.9.6", "build-legacy");
  const directories = new Map<string, string>();
  for (let invocation = 0; invocation < 4; invocation++) {
    const buildId = `2026.9.7-release-c074824a27c${invocation % 2}-2026-09-29T23-33-45.013Z`;
    await fs.writeFile(path.join(root, "dist", "build-info.json"), JSON.stringify({ buildId }));
    const directory = expectDefined(
      resolveBranchCompileCacheDirectory({
        installRoot: root,
        env: { NODE_COMPILE_CACHE: inherited },
      }),
      "compile cache directory",
    );
    expect(path.dirname(directory)).toBe(path.join(base, "branch", "2026.9.6"));
    expect(path.basename(directory)).toMatch(/^[a-f0-9]{16}$/);
    if (directories.has(buildId)) {
      expect(directory).toBe(directories.get(buildId));
    } else {
      expect([...directories.values()]).not.toContain(directory);
      directories.set(buildId, directory);
    }
    await fs.mkdir(directory, { recursive: true });
    await sparseFile(path.join(directory, "bytecode"), 32 * MiB);
    await maintainBranchCompileCache(directory);
    expect(await fs.readdir(path.dirname(directory))).toEqual([path.basename(directory)]);
    inherited = directory;
  }
});

it("prunes old bytecode and caps a 600 MiB cache without touching neighboring caches", async () => {
  const root = tempDirs.make("branch-cache-retention-");
  const cache = path.join(root, "branch");
  const directory = path.join(cache, "2026.9.6", "1000-100");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(root, "another-app"), "keep");
  for (let index = 0; index < 6; index++) {
    await sparseFile(path.join(directory, `bytecode-${index}`), 100 * MiB);
  }
  const old = path.join(directory, "expired");
  await fs.writeFile(old, "old");
  const expired = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  await fs.utimes(old, expired, expired);
  await fs.utimes(cache, expired, expired);
  await maintainBranchCompileCache(directory);
  const files = await fs.readdir(directory);
  const bytes = (
    await Promise.all(files.map(async (name) => (await fs.stat(path.join(directory, name))).size))
  ).reduce((total, size) => total + size, 0);
  expect(bytes).toBe(500 * MiB);
  expect(files).not.toContain("expired");
  expect(await fs.readFile(path.join(root, "another-app"), "utf8")).toBe("keep");
});

it.each(["root", "version", "build"] as const)(
  "does not traverse a symlinked %s cache directory",
  async (boundary) => {
    const root = tempDirs.make("branch-cache-symlink-");
    const outside = path.join(root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "keep"), "keep");
    const cache = path.join(root, "cache", "branch");
    const version = path.join(cache, "2026.9.6");
    const directory = path.join(version, "1000-100");
    const target = boundary === "root" ? cache : boundary === "version" ? version : directory;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.symlink(outside, target, process.platform === "win32" ? "junction" : "dir");
    await maintainBranchCompileCache(directory);
    expect(await fs.readdir(outside)).toEqual(["keep"]);
  },
);
