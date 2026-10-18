import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MISSING_SIGNING_SECRET,
  assertUpdaterTrustRoot,
  buildLatestJson,
  collectSignedPlatforms,
  readTrustedUpdaterPubkey,
  readUpdaterPubkey,
  requireUpdateSigningSecret,
  signUpdateFile,
  updaterAssetName,
  writeReleaseLatestJson,
} from "./update-signing.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("the committed desktop pubkey matches the Linux companion updater trust root", () => {
  const desktop = readUpdaterPubkey();
  assert.match(desktop, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(desktop, readTrustedUpdaterPubkey());
  assert.equal(assertUpdaterTrustRoot(), desktop);
  const embedded = readFileSync(join(here, "../src/updater-pubkey.ts"), "utf8");
  assert.ok(embedded.includes(desktop), "desktop/src/updater-pubkey.ts must match updater-pubkey.txt; a rotation changes both");
});

test("component-release fails when the update signing secret is missing and skips the paid P12 when it is empty", () => {
  const workflow = readFileSync(join(here, "../../.github/workflows/component-release.yml"), "utf8");
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY is missing/);
  assert.match(workflow, /sign-release-updates\.mjs/);
  assert.match(workflow, /BRANCH_REQUIRE_SIGNED_UPDATES: "1"/);
  assert.match(workflow, /Paid Apple\/Azure code-signing certs stay off/);
  assert.match(workflow, /if \[ -z "\$BRANCH_MACOS_SIGNING_P12" \] && \[ -z "\$BRANCH_MACOS_SIGNING_PASSWORD" \]; then/);
  const checks = readFileSync(join(here, "../../.github/workflows/desktop-checks.yml"), "utf8");
  assert.match(checks, /scripts\/update-signing\.test\.mjs scripts\/sign-release-updates\.test\.mjs/);
});

test("a missing signing secret fails with the generate-and-commit-pubkey instructions", () => {
  assert.throws(() => requireUpdateSigningSecret({}), { message: MISSING_SIGNING_SECRET });
  assert.equal(requireUpdateSigningSecret({ TAURI_SIGNING_PRIVATE_KEY: "k" }), true);
});

test("each platform names its shipped update payload", () => {
  assert.equal(updaterAssetName("darwin-aarch64", "0.4.4"), "branch-desktop-0.4.4-darwin-arm64.tar.gz");
  assert.equal(updaterAssetName("linux-x86_64", "0.4.4"), "Branch-Agent-0.4.4-linux-x64.AppImage");
  assert.equal(updaterAssetName("windows-x86_64", "0.4.4"), "Branch-Agent-Setup-0.4.4-win32-x64.exe");
});

test("latest.json requires a signature per platform and keeps the payload notes short", () => {
  const json = JSON.parse(buildLatestJson({
    version: "0.4.4",
    notes: "n".repeat(3000),
    pubDate: "2026-10-18T00:00:00.000Z",
    platforms: {
      "linux-x86_64": { signature: "c2ln", url: "https://github.com/KeepOak/Branch-Agent/releases/download/v0.4.4/Branch-Agent-0.4.4-linux-x64.AppImage" },
      "darwin-aarch64": { signature: "c2ln", url: "https://github.com/KeepOak/Branch-Agent/releases/download/v0.4.4/branch-desktop-0.4.4-darwin-arm64.tar.gz" },
      "windows-x86_64": { signature: "c2ln", url: "https://github.com/KeepOak/Branch-Agent/releases/download/v0.4.4/Branch-Agent-Setup-0.4.4-win32-x64.exe" },
    },
  }));
  assert.equal(json.notes.length, 2000);
  assert.deepEqual(Object.keys(json.platforms).toSorted(), ["darwin-aarch64", "linux-x86_64", "windows-x86_64"]);
  assert.throws(() => buildLatestJson({ version: "0.4.4", pubDate: "2026-10-18T00:00:00.000Z", platforms: {} }), /needs a \.sig per platform/);
});

test("signing refuses a missing secret, keeps bytes, and writes the .sig", async () => {
  const root = await mkdtemp(join(tmpdir(), "branch-update-sign-"));
  try {
    const { writeFileSync } = await import("node:fs");
    const file = join(root, "payload.bin");
    await writeFile(file, "trusted-bytes");
    assert.throws(() => signUpdateFile(file, {}), { message: MISSING_SIGNING_SECRET });
    const signed = [];
    signUpdateFile(file, { TAURI_SIGNING_PRIVATE_KEY: "k" }, (path) => {
      signed.push(path);
      writeFileSync(`${path}.sig`, "c2lnbmF0dXJl");
    });
    assert.equal(await readFile(file, "utf8"), "trusted-bytes");
    assert.equal(await readFile(`${file}.sig`, "utf8"), "c2lnbmF0dXJl");
    assert.deepEqual(signed, [file]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("collectSignedPlatforms and writeReleaseLatestJson publish one .sig per present platform", async () => {
  const root = await mkdtemp(join(tmpdir(), "branch-latest-json-"));
  try {
    await mkdir(root, { recursive: true });
    const version = "0.4.4";
    await writeFile(join(root, updaterAssetName("linux-x86_64", version)), "linux");
    await writeFile(join(root, `${updaterAssetName("linux-x86_64", version)}.sig`), "bGludXg=");
    await writeFile(join(root, updaterAssetName("darwin-aarch64", version)), "mac");
    await writeFile(join(root, `${updaterAssetName("darwin-aarch64", version)}.sig`), "bWFj");
    await writeFile(join(root, updaterAssetName("windows-x86_64", version)), "win");
    await writeFile(join(root, `${updaterAssetName("windows-x86_64", version)}.sig`), "d2lu");
    const platforms = collectSignedPlatforms(root, version, "https://example.test/v0.4.4");
    assert.deepEqual(Object.keys(platforms).toSorted(), ["darwin-aarch64", "linux-x86_64", "windows-x86_64"]);
    const written = writeReleaseLatestJson(root, {
      version, notes: "signed updates", pubDate: "2026-10-18T00:00:00.000Z", urlBase: "https://example.test/v0.4.4",
    });
    assert.equal(written.platforms["linux-x86_64"].signature, "bGludXg=");
    const latest = JSON.parse(await readFile(join(root, "latest.json"), "utf8"));
    assert.equal(latest.version, version);
    assert.equal(latest.platforms["windows-x86_64"].url.endsWith(".exe"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
