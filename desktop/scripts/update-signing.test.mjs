import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MISSING_SIGNING_SECRET,
  assertUpdaterTrustRoot,
  buildLatestJson,
  collectSignedPlatforms,
  readTrustedUpdaterPubkey,
  readUpdaterPubkey,
  requireUpdateSigningSecret,
  signingToolInvocation,
  signUpdateFile,
  updaterAssetName,
  extraUpdateAssetNames,
  verifyUpdateFile,
  writeReleaseLatestJson,
} from "./update-signing.mjs";

const here = dirname(fileURLToPath(import.meta.url));

test("update-signature.ts matches upstream minisign Ed/ED wire format", () => {
  const src = readFileSync(join(here, "../src/update-signature.ts"), "utf8");
  assert.match(src, /const PUBKEY_ALG = Buffer\.from\("Ed"\)/);
  assert.match(src, /const SIG_HASHED = Buffer\.from\("ED"\)/);
  assert.match(src, /const SIG_LEGACY = Buffer\.from\("Ed"\)/);
  // Hashed message is BLAKE2b-512(file) only — never hash||trustedComment.
  assert.match(src, /sig\.hashed \? createHash\("blake2b512"\)\.update\(bytes\)\.digest\(\) : bytes/);
  // Global signature covers signature[64] || trusted_comment — not the 74-byte block.
  assert.match(src, /Buffer\.concat\(\[sig\.signature, Buffer\.from\(sig\.trustedComment\)\]\)/);
  assert.doesNotMatch(src, /const HASHED = Buffer\.from\("Ed"\)/);
  assert.doesNotMatch(src, /Buffer\.concat\(\[createHash\("blake2b512"\)\.update\(bytes\)\.digest\(\), Buffer\.from\(sig\.trustedComment\)\]\)/);
  assert.doesNotMatch(src, /Buffer\.concat\(\[sig\.block,/);
  assert.doesNotMatch(src, /Buffer\.concat\(\[hash, Buffer\.from\(trusted\)\]\)/);
});

test("the committed desktop pubkey matches the Linux companion updater trust root", () => {
  const desktop = readUpdaterPubkey();
  assert.match(desktop, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(desktop, "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDlBMTc2QUJDNDVBMzdERTAKUldUZ2ZhTkZ2R29YbW1udGNQVFhnNHQvMFVaL0RCM1drRFovVm5HWnBoNHdXZXcxdWJMVit4bXAK");
  assert.equal(desktop, readTrustedUpdaterPubkey());
  assert.equal(assertUpdaterTrustRoot(), desktop);
  const embedded = readFileSync(join(here, "../src/updater-pubkey.ts"), "utf8");
  assert.ok(embedded.includes(desktop), "desktop/src/updater-pubkey.ts must match updater-pubkey.txt; a rotation changes both");
  assert.doesNotMatch(desktop, /FA9091404B9A04E5/);
});

test("component-release fails when the update signing secret is missing and skips the paid P12 when it is empty", () => {
  const workflow = readFileSync(join(here, "../../.github/workflows/component-release.yml"), "utf8");
  assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY is missing/);
  assert.match(workflow, /sign-release-updates\.mjs/);
  assert.doesNotMatch(workflow, /BRANCH_REQUIRE_SIGNED_UPDATES:\s*"1"/,
    "BRANCH_REQUIRE_SIGNED_UPDATES stays off until Verifier re-MERGE");
  assert.match(workflow, /Paid Apple\/Azure code-signing certs stay off/);
  assert.match(workflow, /if \[ -z "\$BRANCH_MACOS_SIGNING_P12" \] && \[ -z "\$BRANCH_MACOS_SIGNING_PASSWORD" \]; then/);
  const checks = readFileSync(join(here, "../../.github/workflows/desktop-checks.yml"), "utf8");
  assert.match(checks, /scripts\/update-signing\.test\.mjs scripts\/sign-release-updates\.test\.mjs/);
});

test("a missing signing secret fails with the generate-and-commit-pubkey instructions", () => {
  assert.throws(() => requireUpdateSigningSecret({}), { message: MISSING_SIGNING_SECRET });
  assert.equal(requireUpdateSigningSecret({ TAURI_SIGNING_PRIVATE_KEY: "k" }), true);
  assert.equal(requireUpdateSigningSecret({ TAURI_SIGNING_PRIVATE_KEY: "k", TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" }), true);
});

test("an empty or missing signing password is valid for a passwordless key", async () => {
  const root = await mkdtemp(join(tmpdir(), "branch-update-sign-nopw-"));
  try {
    const { writeFileSync } = await import("node:fs");
    const file = join(root, "payload.bin");
    await writeFile(file, "trusted-bytes");
    const seen = [];
    signUpdateFile(file, { TAURI_SIGNING_PRIVATE_KEY: "k" }, (path, env) => {
      seen.push(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD);
      writeFileSync(`${path}.sig`, "c2lnbmF0dXJl");
    });
    signUpdateFile(file, { TAURI_SIGNING_PRIVATE_KEY: "k", TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "" }, (path, env) => {
      seen.push(env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD);
      writeFileSync(`${path}.sig`, "c2lnbmF0dXJl");
    });
    assert.deepEqual(seen, ["", ""]);
    const workflow = readFileSync(join(here, "../../.github/workflows/component-release.yml"), "utf8");
    assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY_PASSWORD="\$\{TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-\}"/);
    assert.doesNotMatch(workflow, /if \[\[ -z "\$\{TAURI_SIGNING_PRIVATE_KEY_PASSWORD/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("each platform names its shipped update payload", () => {
  assert.equal(updaterAssetName("darwin-aarch64", "0.4.4"), "branch-desktop-0.4.4-darwin-arm64.tar.gz");
  assert.equal(updaterAssetName("linux-x86_64", "0.4.4"), "Branch-Agent-0.4.4-linux-x64.AppImage");
  assert.equal(updaterAssetName("windows-x86_64", "0.4.4"), "branch-desktop-0.4.4-win32-x64.tar.gz");
  assert.deepEqual(extraUpdateAssetNames("0.4.4"), [
    "branch-desktop-0.4.4-linux-x64.tar.gz",
    "branch-desktop-app-0.4.4-linux-x64.tar.gz",
    "branch-desktop-app-0.4.4-win32-x64.tar.gz",
    "Branch-Agent-Setup-0.4.4-win32-x64.exe",
  ]);
});

test("latest.json requires a signature per platform and keeps the payload notes short", () => {
  const json = JSON.parse(buildLatestJson({
    version: "0.4.4",
    notes: "n".repeat(3000),
    pubDate: "2026-10-18T00:00:00.000Z",
    platforms: {
      "linux-x86_64": { signature: "c2ln", url: "https://github.com/KeepOak/Branch-Agent/releases/download/v0.4.4/Branch-Agent-0.4.4-linux-x64.AppImage" },
      "darwin-aarch64": { signature: "c2ln", url: "https://github.com/KeepOak/Branch-Agent/releases/download/v0.4.4/branch-desktop-0.4.4-darwin-arm64.tar.gz" },
      "windows-x86_64": { signature: "c2ln", url: "https://github.com/KeepOak/Branch-Agent/releases/download/v0.4.4/branch-desktop-0.4.4-win32-x64.tar.gz" },
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

test("Windows .cmd and .bat signing tools go through cmd.exe so execFileSync is not EINVAL", () => {
  assert.deepEqual(signingToolInvocation("minisign", ["-Vm", "file"], "linux"), { file: "minisign", args: ["-Vm", "file"] });
  assert.deepEqual(signingToolInvocation("minisign.exe", ["-Vm", "file"], "win32"), { file: "minisign.exe", args: ["-Vm", "file"] });
  assert.deepEqual(signingToolInvocation("minisign.cjs", ["-Vm", "file"], "win32"), {
    file: process.execPath,
    args: ["minisign.cjs", "-Vm", "file"],
  });
  assert.deepEqual(signingToolInvocation(join("C:", "tools", "minisign.cmd"), ["-Vm", "payload"], "win32"), {
    file: "cmd.exe",
    args: ["/d", "/c", join("C:", "tools", "minisign.cmd"), "-Vm", "payload"],
  });
  assert.deepEqual(signingToolInvocation("cargo-tauri.bat", ["signer", "sign", "file"], "win32"), {
    file: "cmd.exe",
    args: ["/d", "/c", "cargo-tauri.bat", "signer", "sign", "file"],
  });
});

test("verify temps live under os.tmpdir and are deleted, never next to the payload", async () => {
  const root = await mkdtemp(join(tmpdir(), "branch-update-verify-tmp-"));
  const previous = process.env.MINISIGN;
  try {
    const file = join(root, "payload.bin");
    await writeFile(file, "trusted-bytes");
    await writeFile(`${file}.sig`, Buffer.from("untrusted comment: signature\n").toString("base64"));
    const seen = join(root, "minisign-args.txt");
    const stub = join(root, "minisign.cjs");
    writeFileSync(stub, `require("fs").writeFileSync(${JSON.stringify(seen)}, process.argv.slice(2).join(" "));\n`);
    process.env.MINISIGN = stub;
    verifyUpdateFile(file, Buffer.from("untrusted comment: minisign public key: TEST\n").toString("base64"));
    const args = readFileSync(seen, "utf8");
    assert.match(args, /minisign\.pub/);
    assert.match(args, /minisign\.minisig/);
    assert.ok(args.includes(tmpdir()), "verify materials must be under os.tmpdir");
    assert.equal(readdirSync(root).some(name => name.startsWith(".updater-") || name.endsWith(".pub") || name.endsWith(".minisig")), false);
    assert.equal(existsSync(file), true);
  } finally {
    if (previous === undefined) delete process.env.MINISIGN;
    else process.env.MINISIGN = previous;
    await rm(root, { recursive: true, force: true });
  }
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
    assert.equal(latest.platforms["windows-x86_64"].url.endsWith("branch-desktop-0.4.4-win32-x64.tar.gz"), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
