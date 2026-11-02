// The only digests the desktop main process may use. Electron's BoringSSL lacks
// several OpenSSL digests (notably BLAKE2b, see #2104), so node:crypto hashing
// in desktop/ goes through here. BLAKE2b must stay pure-JS (./blake2b.ts).
import { createHash } from "node:crypto";
import { blake2b512 } from "./blake2b";

export const ELECTRON_SAFE_DIGESTS = ["sha1", "sha256", "sha512"] as const;
export type ElectronSafeDigest = (typeof ELECTRON_SAFE_DIGESTS)[number];

export function digest(algorithm: ElectronSafeDigest | "blake2b512", data: Uint8Array): Buffer {
  if (algorithm === "blake2b512") return blake2b512(data);
  if (!(ELECTRON_SAFE_DIGESTS as readonly string[]).includes(algorithm)) {
    throw new Error(`digest ${algorithm} is not Electron-safe`);
  }
  return createHash(algorithm).update(data).digest();
}
