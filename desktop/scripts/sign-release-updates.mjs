#!/usr/bin/env node
// Sign each platform's shipped update payload with the free Tauri/minisign key and write latest.json.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertUpdaterTrustRoot,
  requireUpdateSigningSecret,
  signUpdateFile,
  updaterAssetName,
  verifyUpdateFile,
  writeReleaseLatestJson,
} from "./update-signing.mjs";

const PLATFORMS = ["darwin-aarch64", "linux-x86_64", "windows-x86_64"];

export function signReleaseUpdates(directory, version, env = process.env, deps = {}) {
  requireUpdateSigningSecret(env);
  const pubkey = (deps.assertTrust ?? assertUpdaterTrustRoot)();
  const sign = deps.sign ?? signUpdateFile;
  const verify = deps.verify ?? verifyUpdateFile;
  const signed = [];
  for (const platform of PLATFORMS) {
    const file = join(directory, updaterAssetName(platform, version));
    if (!existsSync(file)) continue;
    sign(file, env, deps.signFile);
    verify(file, pubkey, deps.verifyFile);
    signed.push(platform);
  }
  if (signed.length === 0) throw new Error("No platform update payloads were present to sign");
  const urlBase = `https://github.com/KeepOak/Branch-Agent/releases/download/v${version}`;
  writeReleaseLatestJson(directory, {
    version,
    notes: "Branch Agent desktop update. The app ships unsigned; this file's signatures use the free updater key.",
    pubDate: new Date().toISOString(),
    urlBase,
  });
  return signed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] ?? "");
  const version = process.argv[3];
  if (!directory || !version) {
    console.error("usage: node desktop/scripts/sign-release-updates.mjs <assets-dir> <version>");
    process.exit(1);
  }
  console.log(JSON.stringify({ signed: signReleaseUpdates(directory, version) }));
}
