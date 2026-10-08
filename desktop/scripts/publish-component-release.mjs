import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
async function compareStatus(base, head, request) {
  return request(["api", `repos/${repository}/compare/${base}...${head}`, "--jq", ".status"]);
}

/**
 * A release must be built from a commit on main and must be newer than GitHub latest.
 * compare(commit...main) is "identical" or "ahead" when commit is main or an ancestor of main,
 * so main may move during a 10–15 minute batched build without aborting.
 * Only a newer already-published latest (or a commit that left main) refuses publication.
 */
async function assertPublishableMainCommit(commit, request) {
  assert(["identical", "ahead"].includes(await compareStatus(commit, "main", request)), "Release source is not a commit on main");
  let latest;
  try { latest = JSON.parse(await request(["api", `repos/${repository}/releases/latest`])); }
  catch (error) { if (!error.stderr?.includes("HTTP 404")) throw error; }
  if (!latest) return;
  assert.match(latest.target_commitish, /^[a-f0-9]{40}$/, "GitHub latest does not name an exact source commit");
  assert.equal(await compareStatus(latest.target_commitish, commit, request), "ahead",
    "GitHub latest is the same or a newer main commit; do not publish a stale automatic update");
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

export async function verifyPublicLatest(directory, commit, version, proof, request, download = fetch) {
  const latest = JSON.parse(await request(["api", `repos/${repository}/releases/latest`]));
  assert.equal(latest.tag_name, `v${version}`, "Published release is not GitHub latest");
  assert.equal(latest.target_commitish, commit, "GitHub latest has a different source identity");
  assert.equal(latest.draft, false); assert.equal(latest.prerelease, false);
  for (const target of proof.targets) {
    const name = `branch-release-${target}.json`, expected = proof.inventory[name];
    assert(expected.bytes <= 1_048_576, "Release manifest exceeds readback limit");
    const response = await download(`https://github.com/${repository}/releases/latest/download/${name}`, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
    assert.equal(response.status, 200, "Latest manifest is not publicly downloadable");
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.length; assert(bytes <= expected.bytes, "Latest manifest exceeds expected byte count"); chunks.push(chunk); }
    const body = Buffer.concat(chunks);
    assert.equal(body.length, expected.bytes);
    assert.equal(createHash("sha256").update(body).digest("hex"), expected.sha256, "Public latest manifest differs from verified upload");
    const manifest = JSON.parse(body.toString("utf8"));
    assert.equal(manifest.sourceCommit, commit); assert.equal(manifest.version, version);
    assert.deepEqual(manifest, JSON.parse(await readFile(join(directory, name), "utf8")), "Public latest component hashes differ");
  }
  return { tag: latest.tag_name, commit, publiclyVerifiedTargets: proof.targets };
}

export async function publishRelease(directory, commit, version, request = gh, download = fetch) {
  const proof = await verifyReleaseDirectory(directory, commit, version);
  assert.deepEqual(proof.targets, ["darwin-arm64", "linux-x64", "win32-x64"], "All native release targets must pass");
  await assertPublishableMainCommit(commit, request);
  const tag = `v${version}`;
  const existing = JSON.parse(await request(["api", `repos/${repository}/releases`, "--paginate", "--slurp"])).flat();
  assert(!existing.some(item => item.tag_name === tag), "Release tags/assets are immutable; choose a new source version");
  await ensureImmutableTag(tag, commit, request);
  const checksums = Object.entries(proof.inventory).map(([name, info]) => `${info.sha256}  ${name}`).join("\n") + "\n";
  await writeFile(join(directory, "SHA256SUMS"), checksums);
  const names = [...Object.keys(proof.inventory), "SHA256SUMS"].sort();
  const notes = join(directory, "release-notes.txt");
  await writeFile(notes, `Branch Agent built from ${commit}.\n\nNative Windows x64, macOS arm64 and Linux x64 packages; verified engine, renderer and desktop app update components. Existing data and credentials are retained. Installed desktop apps take the new desktop app on their next start.\n`);
  await request(["release", "create", tag, ...names.map(name => join(directory, name)), "--repo", repository,
    "--target", commit, "--verify-tag", "--draft", "--title", `Branch Agent ${version}`, "--notes-file", notes]);
  const downloaded = await mkdtemp(join(process.env.RUNNER_TEMP ?? tmpdir(), "branch-release-readback-"));
  await request(["release", "download", tag, "--repo", repository, "--dir", downloaded]);
  assert.deepEqual((await readdir(downloaded)).sort(), names, "Uploaded release has missing/extra assets");
  for (const name of names) assert.deepEqual(await fileDigest(join(downloaded, name)), await fileDigest(join(directory, name)), `GitHub upload readback differs: ${name}`);
  await assertPublishableMainCommit(commit, request);
  await request(["release", "edit", tag, "--repo", repository, "--draft=false", "--latest"]);
  const release = JSON.parse(await request(["api", `repos/${repository}/releases/tags/${tag}`]));
  assert.equal(release.draft, false); assert.equal(release.prerelease, false); assert.equal(release.target_commitish, commit);
  const publicLatest = await verifyPublicLatest(directory, commit, version, proof, request, download);
  return { release, publicLatest };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await publishRelease(resolve(process.argv[2]), process.argv[3], process.argv[4])));
}
