// Free update signing: the same Tauri/minisign key the Linux companion already uses
// (TAURI_SIGNING_PRIVATE_KEY + the committed pubkey). The app ships unsigned; each
// platform's update payload gets a .sig verified against that pubkey. No paid certificate.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const UPDATER_PUBKEY_FILE = fileURLToPath(new URL("../updater-pubkey.txt", import.meta.url));
export const TAURI_UPDATER_CONFIG = fileURLToPath(
  new URL("../../engine/apps/linux/src-tauri/tauri.conf.json", import.meta.url),
);
export const MISSING_SIGNING_SECRET =
  "TAURI_SIGNING_PRIVATE_KEY is missing. Free update signing needs this repository secret (a Tauri/minisign private key). Generate with: cargo tauri signer generate. Put the public key in desktop/updater-pubkey.txt and engine/apps/linux/src-tauri/tauri.conf.json plugins.updater.pubkey. Never commit the private key. A key rotation must change the committed pubkey with it.";

const PUBKEY = /^[A-Za-z0-9+/]+={0,2}$/u;
const PLATFORM_ASSETS = {
  "darwin-aarch64": (version) => `branch-desktop-${version}-darwin-arm64.tar.gz`,
  "linux-x86_64": (version) => `Branch-Agent-${version}-linux-x64.AppImage`,
  "windows-x86_64": (version) => `Branch-Agent-Setup-${version}-win32-x64.exe`,
};

export function readUpdaterPubkey(file = UPDATER_PUBKEY_FILE) {
  const pubkey = readFileSync(file, "utf8").trim();
  assert(PUBKEY.test(pubkey), "Committed updater pubkey must be standard base64");
  return pubkey;
}

export function readTrustedUpdaterPubkey(configPath = TAURI_UPDATER_CONFIG) {
  const pubkey = JSON.parse(readFileSync(configPath, "utf8")).plugins?.updater?.pubkey;
  assert(typeof pubkey === "string" && PUBKEY.test(pubkey), "Tauri updater pubkey is missing or not base64");
  return pubkey;
}

/** The desktop file and the Linux companion config must name the same trust root. */
export function assertUpdaterTrustRoot() {
  const desktop = readUpdaterPubkey();
  const companion = readTrustedUpdaterPubkey();
  assert.equal(desktop, companion, "desktop/updater-pubkey.txt must match plugins.updater.pubkey; a key rotation changes both");
  return desktop;
}

export function requireUpdateSigningSecret(env = process.env) {
  if (!env.TAURI_SIGNING_PRIVATE_KEY) throw new Error(MISSING_SIGNING_SECRET);
  return true;
}

export function updaterAssetName(platform, version) {
  const name = PLATFORM_ASSETS[platform]?.(version);
  if (!name) throw new Error(`Unsupported updater platform: ${platform}`);
  return name;
}

export function buildLatestJson({ version, notes = "", pubDate, platforms }) {
  assert.match(String(version), /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/, "Invalid updater version");
  assert(typeof pubDate === "string" && Number.isFinite(Date.parse(pubDate)), "Invalid updater pub_date");
  const keys = Object.keys(platforms).toSorted();
  assert(keys.length > 0, "latest.json needs a .sig per platform");
  for (const platform of keys) {
    const entry = platforms[platform];
    assert(typeof entry?.url === "string" && entry.url.startsWith("https://"), `Missing updater URL for ${platform}`);
    assert(typeof entry?.signature === "string" && entry.signature.length > 0 && entry.signature.length <= 16_384,
      `Missing updater .sig for ${platform}`);
  }
  return `${JSON.stringify({
    version,
    notes: String(notes).slice(0, 2000),
    pub_date: pubDate,
    platforms,
  }, null, 2)}\n`;
}

export function collectSignedPlatforms(directory, version, urlBase, names = PLATFORM_ASSETS) {
  const platforms = {};
  for (const [platform, nameFor] of Object.entries(names)) {
    const name = nameFor(version);
    const file = join(directory, name);
    const sigFile = `${file}.sig`;
    if (!existsSync(file)) continue;
    assert(existsSync(sigFile), `${name} is present but ${name}.sig is missing`);
    platforms[platform] = {
      url: `${urlBase.replace(/\/$/, "")}/${name}`,
      signature: readFileSync(sigFile, "utf8").trim(),
    };
  }
  return platforms;
}

/** Sign `file` in place (bytes unchanged) and write `file.sig`. Inject `sign` in tests. */
export function signUpdateFile(file, env = process.env, sign = defaultSign) {
  requireUpdateSigningSecret(env);
  const before = readFileSync(file);
  sign(file, env);
  const after = readFileSync(file);
  assert(before.equals(after), "Signing must preserve the update payload bytes");
  const sig = `${file}.sig`;
  assert(existsSync(sig) && readFileSync(sig).length > 0, `Signing did not create ${basename(sig)}`);
  return sig;
}

function defaultSign(file, env) {
  const binary = env.CARGO_TAURI ?? "cargo-tauri";
  execFileSync(binary, ["signer", "sign", file], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...env, TAURI_SIGNING_PRIVATE_KEY: env.TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "" },
    timeout: 120_000,
    windowsHide: true,
  });
}

/** Decode the committed pubkey and the artifact .sig, then verify with minisign. Inject `verify` in tests. */
export function verifyUpdateFile(file, pubkey, verify = defaultVerify) {
  const sig = `${file}.sig`;
  assert(existsSync(sig), `${basename(file)}.sig is missing`);
  verify(file, sig, pubkey);
}

function defaultVerify(file, sig, pubkey) {
  const binary = process.env.MINISIGN ?? "minisign";
  const dir = dirname(file);
  const pubFile = join(dir, `.updater-${process.pid}.pub`);
  const minisig = join(dir, `.updater-${process.pid}.minisig`);
  writeFileSync(pubFile, Buffer.from(pubkey, "base64"), { mode: 0o600 });
  writeFileSync(minisig, Buffer.from(readFileSync(sig, "utf8").trim(), "base64"), { mode: 0o600 });
  try {
    execFileSync(binary, ["-Vm", file, "-x", minisig, "-p", pubFile], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      windowsHide: true,
    });
  } finally {
    try { writeFileSync(pubFile, ""); } catch { /* ignore */ }
  }
}

export function writeReleaseLatestJson(directory, { version, notes, pubDate, urlBase }) {
  const pubkey = assertUpdaterTrustRoot();
  const platforms = collectSignedPlatforms(directory, version, urlBase);
  assert(Object.keys(platforms).length > 0, "No signed platform payloads were found for latest.json");
  const json = buildLatestJson({ version, notes, pubDate, platforms });
  writeFileSync(join(directory, "latest.json"), json, { flag: "wx" });
  return { pubkey, platforms, json };
}
