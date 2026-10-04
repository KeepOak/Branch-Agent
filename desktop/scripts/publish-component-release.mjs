import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { fileDigest, verifyReleaseDirectory } from "./release-inventory.mjs";

const repository = "KeepOak/Branch-Agent";
const execute = promisify(execFile);
async function gh(args) {
  const result = await execute("gh", args, { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return result.stdout.trim();
}
async function assertCurrentMain(commit, request) {
  assert.equal(await request(["api", `repos/${repository}/git/ref/heads/main`, "--jq", ".object.sha"]), commit,
    "A newer main commit exists; do not publish a stale automatic update");
}

async function ensureImmutableTag(tag, commit, request) {
  let reference;
  try { reference = JSON.parse(await request(["api", `repos/${repository}/git/ref/tags/${tag}`])); }
  catch (error) { if (!error.stderr?.includes("HTTP 404")) throw error; }
  if (!reference) {
    await request(["api", "--method", "POST", `repos/${repository}/git/refs`, "-f", `ref=refs/tags/${tag}`, "-f", `sha=${commit}`]);
    return;
  }
  let object = reference.object;
  while (object.type === "tag") object = JSON.parse(await request(["api", `repos/${repository}/git/tags/${object.sha}`])).object;
  assert.equal(object.type, "commit");
  assert.equal(object.sha, commit, "Existing immutable tag points at a different source commit");
}

export async function publishRelease(directory, commit, version, request = gh) {
  const proof = await verifyReleaseDirectory(directory, commit, version);
  assert.deepEqual(proof.targets, ["darwin-arm64", "linux-x64", "win32-x64"], "All native release targets must pass");
  await assertCurrentMain(commit, request);
  const tag = `v${version}`;
  const existing = JSON.parse(await request(["api", `repos/${repository}/releases`, "--paginate", "--slurp"])).flat();
  assert(!existing.some(item => item.tag_name === tag), "Release tags/assets are immutable; choose a new source version");
  await ensureImmutableTag(tag, commit, request);
  const checksums = Object.entries(proof.inventory).map(([name, info]) => `${info.sha256}  ${name}`).join("\n") + "\n";
  await writeFile(join(directory, "SHA256SUMS"), checksums);
  const names = [...Object.keys(proof.inventory), "SHA256SUMS"].sort();
  const notes = join(directory, "release-notes.txt");
  await writeFile(notes, `Branch Agent built from ${commit}.\n\nNative Windows x64, macOS arm64 and Linux x64 packages; verified engine and renderer update components. Existing data and credentials are retained. Desktop launcher changes require installing the new desktop package.\n`);
  await request(["release", "create", tag, ...names.map(name => join(directory, name)), "--repo", repository,
    "--target", commit, "--verify-tag", "--draft", "--title", `Branch Agent ${version}`, "--notes-file", notes]);
  const downloaded = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), "branch-release-readback-"));
  await request(["release", "download", tag, "--repo", repository, "--dir", downloaded]);
  assert.deepEqual((await readdir(downloaded)).sort(), names, "Uploaded release has missing/extra assets");
  for (const name of names) assert.deepEqual(await fileDigest(join(downloaded, name)), await fileDigest(join(directory, name)), `GitHub upload readback differs: ${name}`);
  await assertCurrentMain(commit, request);
  await request(["release", "edit", tag, "--repo", repository, "--draft=false", "--latest"]);
  const release = JSON.parse(await request(["api", `repos/${repository}/releases/tags/${tag}`]));
  assert.equal(release.draft, false); assert.equal(release.prerelease, false); assert.equal(release.target_commitish, commit);
  return release;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await publishRelease(resolve(process.argv[2]), process.argv[3], process.argv[4])));
}
