import { createHash } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";

function header(name, size, mode) {
  let prefix = "";
  if (Buffer.byteLength(name) > 100) {
    let cut = name.lastIndexOf("/");
    while (cut >= 0 && (Buffer.byteLength(name.slice(0, cut)) > 155 || Buffer.byteLength(name.slice(cut + 1)) > 100)) {
      cut = name.lastIndexOf("/", cut - 1);
    }
    if (cut < 0) throw new Error("Path exceeds ustar format");
    prefix = name.slice(0, cut); name = name.slice(cut + 1);
  }
  if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error("Path exceeds ustar format");
  const block = Buffer.alloc(512);
  const field = (value, offset, width) => block.write(value, offset, width, "utf8");
  const number = (value, offset, width) => field(value.toString(8).padStart(width - 1, "0") + "\0", offset, width);
  field(name, 0, 100); number(mode & 0o777, 100, 8); number(0, 108, 8); number(0, 116, 8);
  number(size, 124, 12); number(0, 136, 12); block.fill(32, 148, 156); block[156] = 48;
  field("ustar\0", 257, 6); field("00", 263, 2); field(prefix, 345, 155);
  field(block.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return block;
}

async function files(root, folder = root, ancestors = new Set()) {
  const actual = await realpath(folder);
  if (actual !== root && !actual.startsWith(root + sep)) throw new Error("Component symlink leaves deployment root");
  if (ancestors.has(actual)) throw new Error("Component symlink cycle");
  const seen = new Set([...ancestors, actual]);
  const result = [];
  for (const name of (await readdir(folder)).sort()) {
    const file = join(folder, name);
    const target = await realpath(file);
    if (!target.startsWith(root + sep)) throw new Error("Component symlink leaves deployment root");
    const info = await stat(file);
    if (info.isDirectory()) {
      for (const entry of await files(root, file, seen)) result.push(entry);
    }
    else if (info.isFile()) result.push({ file, name: relative(root, file).split(sep).join("/"), size: info.size, mode: info.mode });
    else throw new Error("Unsupported component file type");
  }
  return result;
}

async function archive(root, destination, fileMode) {
  const entries = await files(await realpath(root));
  async function* bytes() {
    for (const entry of entries) {
      yield header(entry.name, entry.size, fileMode ?? entry.mode);
      for await (const chunk of createReadStream(entry.file)) yield chunk;
      const padding = (512 - entry.size % 512) % 512;
      if (padding) yield Buffer.alloc(padding);
    }
    yield Buffer.alloc(1024);
  }
  await pipeline(Readable.from(bytes()), createGzip(), createWriteStream(destination, { flags: "wx" }));
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(destination)) hash.update(chunk);
  return { sha256: hash.digest("hex"), bytes: (await stat(destination)).size,
    expandedBytes: entries.reduce((sum, entry) => sum + entry.size, 0) };
}

async function validateInputs(engine, window) {
  for (const [root, name] of [[engine, "branch.mjs"], [engine, "dist/build-info.json"], [window, "index.html"]]) {
    if (!(await stat(join(root, name))).isFile()) throw new Error(`Incomplete release input: ${name}`);
  }
  let entryFound = false;
  for (const name of ["dist/entry.js", "dist/entry.mjs"]) {
    try { entryFound ||= (await stat(join(engine, name))).isFile(); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!entryFound) throw new Error("Incomplete release input: dist/entry.(m)js");
  const metadata = JSON.parse(await readFile(join(engine, "dist/build-info.json"), "utf8"));
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Invalid engine build metadata");
}

async function existingDigest(file) {
  const hash = createHash("sha256");
  try { for await (const chunk of createReadStream(file)) hash.update(chunk); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
  return hash.digest("hex");
}

/** Deploy engine production dependencies first. In-root symlinks are materialized; external links are rejected. */
export async function makeComponentRelease({ version, tag = version, engine, window, output, sourceCommit, platform = process.platform, arch = process.arch }) {
  if (!/^[\w.-]+$/.test(version) || !/^[\w.-]+$/.test(tag)) throw new Error("Invalid release version/tag");
  if (sourceCommit !== undefined && !/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error("Invalid release source commit");
  if (!["win32", "darwin", "linux"].includes(platform) || !["x64", "arm64", "arm", "ia32"].includes(arch)) throw new Error("Unsupported release target");
  await validateInputs(engine, window);
  await mkdir(output, { recursive: true });
  const destination = await realpath(output);
  for (const root of [await realpath(engine), await realpath(window)]) {
    if (destination === root || destination.startsWith(root + sep)) throw new Error("Release output must be outside component source roots");
  }
  const stage = await mkdtemp(join(output, ".component-stage-"));
  const components = {}; const assets = [];
  const manifestName = `branch-release-${platform}-${arch}.json`;
  try {
    for (const name of ["engine", "window"]) {
      const filename = name === "engine" ? `branch-engine-${version}-${platform}-${arch}.tar.gz` : `branch-window-${version}.tar.gz`;
      const info = await archive(name === "engine" ? engine : window, join(stage, filename), name === "window" ? 0o644 : undefined);
      const existing = await existingDigest(join(output, filename));
      if (existing && (name !== "window" || existing !== info.sha256)) throw new Error(`Release asset collision: ${filename}`);
      components[name] = { url: `https://github.com/KeepOak/Branch-Agent/releases/download/${tag}/${filename}`, ...info,
        ...(name === "engine" ? { platform, arch } : {}) };
      if (!existing) assets.push(filename);
    }
    if (await existingDigest(join(output, manifestName))) throw new Error(`Release manifest already exists: ${manifestName}`);
    const manifest = { schemaVersion: 1, version, components, ...(sourceCommit ? { sourceCommit } : {}) };
    await writeFile(join(stage, manifestName), JSON.stringify(manifest, null, 2) + "\n");
    for (const filename of [...assets, manifestName]) await copyFile(join(stage, filename), join(output, filename), constants.COPYFILE_EXCL);
    return manifest;
  } finally { await rm(stage, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index]?.replace(/^--/, "");
    if (!["version", "tag", "engine", "window", "output", "sourceCommit", "platform", "arch"].includes(key) || !process.argv[index + 1]) throw new Error("Invalid release arguments");
    options[key] = process.argv[index + 1];
  }
  for (const key of ["version", "engine", "window", "output"]) if (!options[key]) throw new Error(`Missing --${key}`);
  await makeComponentRelease(options);
  console.log(`Verified component manifest prepared in ${options.output}`);
}
