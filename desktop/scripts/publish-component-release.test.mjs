import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { makeComponentRelease } from "./make-component-release.mjs";
import { writeReleaseInventory } from "./release-inventory.mjs";
import { PUBLIC_LATEST_BUDGET_MS, publicLatestDelayMs, publishRelease } from "./publish-component-release.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const commit = "a".repeat(40);
const older = "c".repeat(40);
const version = "0.4.3-build-aaaaaaaaaaaa";
const tag = `v${version}`;
const previousTag = "v0.0.1";
const targets = [["win32", "x64"], ["darwin", "arm64"], ["linux", "x64"]];

async function fixture(body) {
  const root = await mkdtemp(join(process.env.BRANCH_RELEASE_TEST_TEMP ?? process.env.RUNNER_TEMP ?? tmpdir(), "release-publish-test-"));
  try {
    const engine = join(root, "engine"), window = join(root, "window"), assets = join(root, "assets");
    await mkdir(join(engine, "dist"), { recursive: true }); await mkdir(window); await mkdir(assets);
    await writeFile(join(engine, "branch.mjs"), "export {};\n");
    await writeFile(join(engine, "dist/entry.js"), "export {};\n");
    await writeFile(join(engine, "dist/build-info.json"), JSON.stringify({ commit }));
    await writeFile(join(window, "index.html"), "<!doctype html><title>Branch</title>");
    const asar = join(root, "desktop-asar"), app = join(root, "desktop-app");
    await mkdir(asar); await mkdir(join(app, "resources"), { recursive: true });
    await writeFile(join(asar, "app.asar"), "offline fixture asar");
    await writeFile(join(app, "Branch Agent.exe"), "offline fixture app"); await writeFile(join(app, "resources/app.asar"), "offline fixture asar");
    const macApp = join(app, "Branch Agent.app", "Contents");
    await mkdir(join(macApp, "Resources"), { recursive: true });
    await mkdir(join(macApp, "MacOS"), { recursive: true });
    await writeFile(join(macApp, "Resources/app.asar"), "offline fixture asar");
    await writeFile(join(macApp, "MacOS/Branch Agent"), "offline fixture app");
    for (const [platform, arch] of targets) {
      const output = join(root, platform); await mkdir(output);
      const desktop = { app: asar, electronVersion: "44.5.1", runtime: app };
      const manifest = await makeComponentRelease({ version, sourceCommit: commit, tag, engine, window, desktop, output, platform, arch });
      const identity = { commit, version, platform, arch, electronVersion: "44.5.1", runtime: {
        electronVersion: "44.5.1", electron: { sha256: "b".repeat(64), bytes: 1 },
        node: { version: "v24.19.0", platform, arch, sha256: "c".repeat(64) } }, smoke: { commit, ready: true, authenticatedHealth: true, exited: true, elapsedMs: 10, runtime: { version: "v24.19.0", platform, arch }, source: "verified-component-archive", archiveSha256: manifest.components.engine.sha256, archiveBytes: manifest.components.engine.bytes, expandedBytes: manifest.components.engine.expandedBytes } };
      await writeReleaseInventory(output, identity); await cp(output, assets, { recursive: true });
    }
    await body(assets);
  } finally { await rm(root, { recursive: true, force: true }); }
}

function compare(base, head) {
  const order = [older, commit, "e".repeat(40), "main"];
  if (!order.includes(base) || !order.includes(head)) return "diverged";
  const delta = order.indexOf(head) - order.indexOf(base);
  return delta === 0 ? "identical" : delta > 0 ? "ahead" : "behind";
}

function githubMock(assets, { staleReads = 0, corrupt = false, previous = true, rollbackFails = false, moveLatestAfterReads = 0 } = {}) {
  const calls = [];
  const publicReads = [];
  const sleeps = [];
  let clock = 0;
  let uploaded = [];
  let published = false;
  let latestTag = previous ? previousTag : null;
  const notFound = () => Object.assign(new Error("gh: Not Found (HTTP 404)"), { stderr: "gh: Not Found (HTTP 404)" });
  const request = async args => {
    calls.push(args);
    if (args[1] === "delete" || args.includes("DELETE")) throw new Error("releases must not be deleted");
    if (args[0] === "api" && args[1].includes("/compare/")) {
      const [base, head] = args[1].split("/compare/")[1].split("...");
      return compare(base, head);
    }
    if (args[0] === "api" && args[1].endsWith("/releases")) return JSON.stringify([latestTag ? [{ tag_name: latestTag }] : []]);
    if (args[0] === "api" && args[1].endsWith("/releases/latest")) {
      if (!latestTag) throw notFound();
      const ours = latestTag === tag;
      return JSON.stringify({ draft: false, prerelease: false, target_commitish: ours ? commit : older, tag_name: latestTag });
    }
    if (args[0] === "release" && args[1] === "edit") {
      const edited = args[2];
      if (args.includes("--draft=true")) {
        if (latestTag === edited) latestTag = previous ? previousTag : null;
        published = false;
      } else if (args.includes("--latest")) {
        if (rollbackFails && edited !== tag) throw new Error("edit failed");
        latestTag = edited;
        if (edited === tag) published = true;
      }
      return "";
    }
    if (args[0] === "api" && args[1].includes("/releases/tags/")) {
      return JSON.stringify({ draft: !published, prerelease: false, target_commitish: commit, tag_name: tag });
    }
    if (args[0] === "api" && args[1].includes("/git/ref/tags/")) return JSON.stringify({ object: { type: "commit", sha: commit } });
    if (args[0] === "release" && args[1] === "create") uploaded = args.slice(3, args.indexOf("--repo"));
    if (args[0] === "release" && args[1] === "download") {
      const directory = args[args.indexOf("--dir") + 1];
      for (const file of uploaded) await cp(file, join(directory, basename(file)));
      if (corrupt) await writeFile(join(directory, basename(uploaded[0])), "changed by remote");
    }
    return "";
  };
  let reads = 0;
  const download = async (url, init) => {
    const downloadAt = calls.findIndex(args => args[1] === "download");
    const editAt = calls.findIndex(args => args[1] === "edit" && args.includes("--draft=false") && args.includes("--latest"));
    assert.ok(downloadAt >= 0 && editAt > downloadAt, "Latest moved before the API asset hashes were checked");
    assert.equal(published, true, "public latest was read before the release was exposed");
    assert.equal(init.cache, "no-store");
    assert.equal(init.headers["Cache-Control"], "no-cache");
    assert.equal(init.headers.Pragma, "no-cache");
    const parsed = new URL(url);
    assert.match(parsed.pathname, /\/releases\/latest\/download\/branch-release-/);
    assert.ok(parsed.searchParams.has("branch-release-check"));
    publicReads.push(parsed.toString());
    reads += 1;
    if (moveLatestAfterReads && reads === moveLatestAfterReads) latestTag = "v9.9.9";
    const name = parsed.pathname.split("/").at(-1);
    const file = await readFile(join(assets, name));
    if (reads <= staleReads) {
      const stale = Buffer.from(file);
      stale[0] ^= 0xff;
      return new Response(stale);
    }
    return new Response(file);
  };
  const sleep = async ms => { sleeps.push(ms); clock += ms; };
  const now = () => clock;
  return { calls, publicReads, sleeps, request, download, sleep, now, latest: () => latestTag };
}

function assertReleaseKept(calls) {
  assert.equal(calls.some(args => args[1] === "delete" || args.includes("DELETE")), false);
}

test("public latest retries back off inside two minutes", () => {
  const delays = [];
  let spent = 0;
  let failure = 0;
  while (spent + publicLatestDelayMs(failure + 1) <= PUBLIC_LATEST_BUDGET_MS) {
    failure += 1;
    const wait = publicLatestDelayMs(failure);
    delays.push(wait);
    spent += wait;
  }
  assert.deepEqual(delays, [2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  assert.equal(spent, PUBLIC_LATEST_BUDGET_MS);
  assert.equal(PUBLIC_LATEST_BUDGET_MS, 120_000);
});

test("publication stays a draft until API hashes match, then retries a stale public latest", () => fixture(async assets => {
  const remote = githubMock(assets, { staleReads: 2 });
  const result = await publishRelease(assets, commit, version, remote.request, remote.download, {
    budgetMs: PUBLIC_LATEST_BUDGET_MS, sleep: remote.sleep, now: remote.now,
  });
  const created = remote.calls.find(args => args[1] === "create");
  assert.ok(created.includes("--draft"));
  assert.equal(created.includes("--latest"), false);
  const edits = remote.calls.filter(args => args[1] === "edit");
  assert.equal(edits.length, 1);
  assert.ok(edits[0].includes("--draft=false"));
  assert.ok(edits[0].includes("--latest"));
  assert.equal(edits[0][2], tag);
  assert.deepEqual(remote.sleeps, [2_000, 4_000]);
  assert.ok(remote.publicReads.length > remote.sleeps.length);
  assert.equal(new Set(remote.publicReads).size, remote.publicReads.length);
  assert.equal(result.publicLatest.tag, tag);
  assert.equal(remote.latest(), tag);
  assertReleaseKept(remote.calls);
}));

test("a public mismatch that survives the retry budget restores the previous Latest and keeps the release", () => fixture(async assets => {
  const remote = githubMock(assets, { staleReads: Number.POSITIVE_INFINITY });
  await assert.rejects(publishRelease(assets, commit, version, remote.request, remote.download, {
    budgetMs: PUBLIC_LATEST_BUDGET_MS, sleep: remote.sleep, now: remote.now,
  }), /differs from verified upload[\s\S]*Restored Latest to v0\.0\.1[\s\S]*kept/);
  assert.deepEqual(remote.sleeps, [2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  const edits = remote.calls.filter(args => args[1] === "edit");
  assert.equal(edits[0][2], tag);
  assert.ok(edits[0].includes("--draft=false"));
  assert.equal(edits[1][2], previousTag);
  assert.ok(edits[1].includes("--latest"));
  assert.equal(remote.latest(), previousTag);
  assertReleaseKept(remote.calls);
}));

test("a public mismatch with no previous Latest returns the release to draft and keeps it", () => fixture(async assets => {
  const remote = githubMock(assets, { staleReads: Number.POSITIVE_INFINITY, previous: false });
  await assert.rejects(publishRelease(assets, commit, version, remote.request, remote.download, {
    budgetMs: PUBLIC_LATEST_BUDGET_MS, sleep: remote.sleep, now: remote.now,
  }), /Moved v0\.4\.3-build-aaaaaaaaaaaa back to draft[\s\S]*kept the release/);
  const edits = remote.calls.filter(args => args[1] === "edit");
  assert.ok(edits.at(-1).includes("--draft=true"));
  assert.equal(remote.latest(), null);
  assertReleaseKept(remote.calls);
}));

test("uploaded bytes that differ never become Latest", () => fixture(async assets => {
  const remote = githubMock(assets, { corrupt: true });
  await assert.rejects(publishRelease(assets, commit, version, remote.request, remote.download, {
    budgetMs: PUBLIC_LATEST_BUDGET_MS, sleep: remote.sleep, now: remote.now,
  }), /readback differs/);
  assert.equal(remote.calls.some(args => args[1] === "edit"), false);
  assert.equal(remote.publicReads.length, 0);
  assert.equal(remote.latest(), previousTag);
  assertReleaseKept(remote.calls);
}));

test("a newer Latest that appears during the public check is left in place", () => fixture(async assets => {
  const remote = githubMock(assets, { staleReads: Number.POSITIVE_INFINITY, moveLatestAfterReads: 1 });
  await assert.rejects(publishRelease(assets, commit, version, remote.request, remote.download, {
    budgetMs: 0, sleep: remote.sleep, now: remote.now,
  }), /left that release in place/);
  assert.equal(remote.calls.filter(args => args[1] === "edit").length, 1);
  assert.equal(remote.latest(), "v9.9.9");
  assertReleaseKept(remote.calls);
}));

test("a failed rollback leaves this release Latest and still fails", () => fixture(async assets => {
  const remote = githubMock(assets, { staleReads: Number.POSITIVE_INFINITY, rollbackFails: true });
  await assert.rejects(publishRelease(assets, commit, version, remote.request, remote.download, {
    budgetMs: 0, sleep: remote.sleep, now: remote.now,
  }), /Failed to restore the previous Latest[\s\S]*still Latest/);
  assert.equal(remote.latest(), tag);
  assert.equal(remote.sleeps.length, 0);
  assertReleaseKept(remote.calls);
}));

test("desktop checks run the publication order test by name", async () => {
  const workflow = await readFile(join(here, "../../.github/workflows/desktop-checks.yml"), "utf8");
  assert.match(workflow, /^\s+run: node --test scripts\/publish-component-release\.test\.mjs\s*$/m);
});
