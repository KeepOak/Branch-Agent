// Minisign verification for desktop updates. The installed app checks a payload's
// .sig against the embedded UPDATER_PUBKEY before staging. Builds that shipped
// without a key (empty/missing) still accept the first signed update.
import { createHash, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { UPDATER_PUBKEY } from "./updater-pubkey";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const HASHED = Buffer.from("Ed");
const LEGACY = Buffer.from("ED");
const PUBKEY_BYTES = 42;
const SIG_BYTES = 74;

export const MISSING_UPDATE_SIGNATURE = "has no .sig; nothing was changed";
export const INVALID_UPDATE_SIGNATURE = "minisign signature is invalid; nothing was changed";

/** The committed trust root, or empty when this build shipped before the key. */
export function embeddedUpdaterPubkey(pubkey: string = UPDATER_PUBKEY): string {
  return typeof pubkey === "string" ? pubkey.trim() : "";
}

export function requiresUpdateSignature(pubkey: string = UPDATER_PUBKEY): boolean {
  return embeddedUpdaterPubkey(pubkey).length > 0;
}

function ed25519PublicKey(raw: Buffer) {
  if (raw.length !== 32) throw new Error(INVALID_UPDATE_SIGNATURE);
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

function decodeTauriBlob(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} ${INVALID_UPDATE_SIGNATURE}`);
  const text = Buffer.from(value.trim(), "base64").toString("utf8");
  if (!text.includes("untrusted comment:")) throw new Error(`${label} ${INVALID_UPDATE_SIGNATURE}`);
  return text;
}

function parsePubkey(pubkey: string): { keyid: Buffer; publicKey: Buffer } {
  const lines = decodeTauriBlob(pubkey, "updater pubkey").trim().split(/\r?\n/);
  const decoded = Buffer.from(lines[1] ?? "", "base64");
  if (decoded.length < PUBKEY_BYTES || !decoded.subarray(0, 2).equals(HASHED)) throw new Error(`updater pubkey ${INVALID_UPDATE_SIGNATURE}`);
  return { keyid: decoded.subarray(2, 10), publicKey: decoded.subarray(10, 42) };
}

function parseSignature(signature: string): { hashed: boolean; keyid: Buffer; signature: Buffer; block: Buffer; trustedComment: string; globalSig: Buffer } {
  const lines = decodeTauriBlob(signature, "update").trim().split(/\r?\n/);
  const block = Buffer.from(lines[1] ?? "", "base64");
  if (block.length < SIG_BYTES) throw new Error(`update ${INVALID_UPDATE_SIGNATURE}`);
  const alg = block.subarray(0, 2);
  const hashed = alg.equals(HASHED);
  if (!hashed && !alg.equals(LEGACY)) throw new Error(`update ${INVALID_UPDATE_SIGNATURE}`);
  const trustedLine = lines[2] ?? "";
  if (!trustedLine.startsWith("trusted comment: ")) throw new Error(`update ${INVALID_UPDATE_SIGNATURE}`);
  const trustedComment = trustedLine.slice("trusted comment: ".length);
  const globalSig = Buffer.from(lines[3] ?? "", "base64");
  if (globalSig.length !== 64) throw new Error(`update ${INVALID_UPDATE_SIGNATURE}`);
  return { hashed, keyid: block.subarray(2, 10), signature: block.subarray(10, 74), block: block.subarray(0, SIG_BYTES), trustedComment, globalSig };
}

function ed25519Check(key: Buffer, message: Buffer, signature: Buffer): boolean {
  try { return verify(null, message, ed25519PublicKey(key), signature); }
  catch { return false; }
}

/** Verify `bytes` against a Tauri/minisign `.sig` (base64 of the minisign signature file) and pubkey. */
export function assertUpdateSignature(bytes: Buffer, signature: string, pubkey: string): void {
  const trust = parsePubkey(pubkey);
  const sig = parseSignature(signature);
  if (!sig.keyid.equals(trust.keyid)) throw new Error(INVALID_UPDATE_SIGNATURE);
  const message = sig.hashed
    ? Buffer.concat([createHash("blake2b512").update(bytes).digest(), Buffer.from(sig.trustedComment)])
    : bytes;
  if (!ed25519Check(trust.publicKey, message, sig.signature)) throw new Error(INVALID_UPDATE_SIGNATURE);
  if (!ed25519Check(trust.publicKey, Buffer.concat([sig.block, Buffer.from(sig.trustedComment)]), sig.globalSig)) {
    throw new Error(INVALID_UPDATE_SIGNATURE);
  }
}

/** A test-only minisign key and a Tauri-shaped .sig for `bytes`. Not used by the installed app. */
export function minisignTestKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPublic = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const keyid = createHash("sha256").update(rawPublic).digest().subarray(0, 8);
  const pubFile = `untrusted comment: minisign public key: ${keyid.toString("hex").toUpperCase()}\n${Buffer.concat([HASHED, keyid, rawPublic]).toString("base64")}\n`;
  return {
    pubkey: Buffer.from(pubFile).toString("base64"),
    rawPublic,
    keyid,
    privateKey,
    sign(bytes: Buffer): string {
      const trusted = `timestamp:${Math.floor(Date.now() / 1000)}\tfile:payload`;
      const hash = createHash("blake2b512").update(bytes).digest();
      const fileSig = sign(null, Buffer.concat([hash, Buffer.from(trusted)]), privateKey);
      const block = Buffer.concat([HASHED, keyid, fileSig]);
      const globalSig = sign(null, Buffer.concat([block, Buffer.from(trusted)]), privateKey);
      const sigFile = `untrusted comment: signature from minisign secret key\n${block.toString("base64")}\ntrusted comment: ${trusted}\n${globalSig.toString("base64")}\n`;
      return Buffer.from(sigFile).toString("base64");
    },
  };
}
