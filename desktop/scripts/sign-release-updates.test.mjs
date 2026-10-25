import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MISSING_SIGNING_SECRET, updaterAssetName } from "./update-signing.mjs";
import { signReleaseUpdates } from "./sign-release-updates.mjs";

test("signReleaseUpdates refuses a missing secret and signs each present platform", async () => {
  const root = await mkdtemp(join(tmpdir(), "branch-sign-release-"));
  try {
    const version = "0.4.4";
    await writeFile(join(root, updaterAssetName("linux-x86_64", version)), "linux");
    await writeFile(join(root, updaterAssetName("windows-x86_64", version)), "win");
    assert.throws(() => signReleaseUpdates(root, version, {}), { message: MISSING_SIGNING_SECRET });
    const signed = [];
    const verified = [];
    const platforms = signReleaseUpdates(root, version, { TAURI_SIGNING_PRIVATE_KEY: "k" }, {
      assertTrust: () => "pubkey",
      sign: (file) => {
        signed.push(file);
        writeFileSync(`${file}.sig`, Buffer.from(file).toString("base64"));
      },
      verify: (file, pubkey) => { verified.push([file, pubkey]); },
    });
    assert.deepEqual(platforms.toSorted(), ["linux-x86_64", "windows-x86_64"]);
    assert.equal(signed.length, 2);
    assert.deepEqual(verified.map(([, pubkey]) => pubkey), ["pubkey", "pubkey"]);
    const latest = JSON.parse(await readFile(join(root, "latest.json"), "utf8"));
    assert.equal(latest.version, version);
    assert.ok(latest.notes.includes("ships unsigned"));
    assert.deepEqual(Object.keys(latest.platforms).toSorted(), ["linux-x86_64", "windows-x86_64"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("signReleaseUpdates fails when no platform payload is present", () => {
  assert.throws(() => signReleaseUpdates(tmpdir(), "0.4.4", { TAURI_SIGNING_PRIVATE_KEY: "k" }, {
    assertTrust: () => "pubkey",
  }), /No platform update payloads were present to sign/);
});

test("signReleaseUpdates also signs staged component archives as sidecar .sig files", async () => {
  const root = await mkdtemp(join(tmpdir(), "branch-sign-extras-"));
  try {
    const version = "0.4.4";
    // Platform payload (windows tar.gz) plus Linux component archive + Setup.
    await writeFile(join(root, updaterAssetName("windows-x86_64", version)), "win-runtime");
    await writeFile(join(root, `branch-desktop-${version}-linux-x64.tar.gz`), "linux-runtime");
    await writeFile(join(root, `Branch-Agent-Setup-${version}-win32-x64.exe`), "setup");
    const signed = [];
    const platforms = signReleaseUpdates(root, version, { TAURI_SIGNING_PRIVATE_KEY: "k" }, {
      assertTrust: () => "pubkey",
      sign: (file) => {
        signed.push(file.split(/[\\/]/).pop());
        writeFileSync(`${file}.sig`, Buffer.from(file).toString("base64"));
      },
      verify: () => {},
    });
    assert.deepEqual(platforms.toSorted(), ["windows-x86_64"]);
    assert.ok(signed.includes(`branch-desktop-${version}-win32-x64.tar.gz`));
    assert.ok(signed.includes(`branch-desktop-${version}-linux-x64.tar.gz`));
    assert.ok(signed.includes(`Branch-Agent-Setup-${version}-win32-x64.exe`));
    const latest = JSON.parse(await readFile(join(root, "latest.json"), "utf8"));
    assert.equal(latest.platforms["windows-x86_64"].url.endsWith(`branch-desktop-${version}-win32-x64.tar.gz`), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});
