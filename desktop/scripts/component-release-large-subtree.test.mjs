// Run with node --experimental-test-module-mocks --test this named file.
import assert from "node:assert/strict";
import * as nativeFs from "node:fs";
import * as nativePromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { Readable } from "node:stream";
import { gunzipSync } from "node:zlib";
import test from "node:test";

// Exercise the actual release caller and real gzip/manifest output. Only the
// input filesystem has a virtual 140,000-file subtree, avoiding disk spam.
test("release maker preserves a subtree larger than the JavaScript spread argument limit", async (t) => {
  const root = await nativePromises.mkdtemp(join(tmpdir(), "branch-release-scale-"));
  try {
    const engine = join(root, "engine"), window = join(root, "window"), output = join(root, "output");
    await nativePromises.mkdir(join(engine, "dist"), { recursive: true });
    await nativePromises.mkdir(window);
    await nativePromises.writeFile(join(engine, "branch.mjs"), "export {};\n");
    await nativePromises.writeFile(join(engine, "dist", "entry.js"), "export {};\n");
    await nativePromises.writeFile(join(engine, "dist", "build-info.json"), '{"version":"fixture"}');
    await nativePromises.writeFile(join(window, "index.html"), "fixture renderer");
    const actualEngine = await nativePromises.realpath(engine), large = join(actualEngine, "large");
    const count = 140000, names = Array.from({ length: count }, (_, i) => `entry-${String(i).padStart(6, "0")}.txt`);
    const virtual = p => String(p) === large || String(p).startsWith(large + sep);
    t.mock.module("node:fs/promises", { namedExports: {
      copyFile: nativePromises.copyFile, mkdir: nativePromises.mkdir, mkdtemp: nativePromises.mkdtemp,
      readFile: nativePromises.readFile, rm: nativePromises.rm, writeFile: nativePromises.writeFile,
      realpath: async p => virtual(p) ? String(p) : nativePromises.realpath(p),
      readdir: async p => String(p) === large ? names : String(p) === actualEngine
        ? [...await nativePromises.readdir(p), "large"] : nativePromises.readdir(p),
      stat: async p => virtual(p) ? { size: String(p) === large ? 0 : 1, mode: 0o644,
        isDirectory: () => String(p) === large, isFile: () => String(p) !== large } : nativePromises.stat(p),
    } });
    t.mock.module("node:fs", { namedExports: { constants: nativeFs.constants, createWriteStream: nativeFs.createWriteStream,
      createReadStream: (p, ...args) => virtual(p) ? Readable.from([Buffer.from([7])]) : nativeFs.createReadStream(p, ...args),
    } });
    const { makeComponentRelease } = await import("./make-component-release.mjs");
    const release = await makeComponentRelease({ version: "scale-fixture", engine, window, output });
    const asset = release.components.engine, archive = join(output, new URL(asset.url).pathname.split("/").at(-1));
    const tar = gunzipSync(await nativePromises.readFile(archive));
    const seen = new Set(); let bytes = 0, entries = 0;
    for (let offset = 0; tar.subarray(offset, offset + 512).some(byte => byte !== 0);) {
      const header = tar.subarray(offset, offset + 512);
      const text = (start, end) => header.subarray(start, end).toString().replace(/\0.*$/, "");
      const size = Number.parseInt(text(124, 136), 8), prefix = text(345, 500);
      const name = (prefix ? prefix + "/" : "") + text(0, 100);
      assert.ok(!seen.has(name), "every input entry appears exactly once"); seen.add(name);
      if (name.startsWith("large/")) assert.deepEqual(tar.subarray(offset + 512, offset + 512 + size), Buffer.from([7]));
      entries++; bytes += size; offset += 512 + Math.ceil(size / 512) * 512;
    }
    assert.equal(entries, count + 3); assert.equal(bytes, asset.expandedBytes);
    for (const name of names) assert.ok(seen.has("large/" + name));
    assert.equal((await nativePromises.readdir(output)).filter(name => name.startsWith(".component-stage-")).length, 0);
  } finally { t.mock.restoreAll(); await nativePromises.rm(root, { recursive: true, force: true }); }
});
