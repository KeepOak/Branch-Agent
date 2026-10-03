// Source: moonrunnerkc/swarm-orchestrator@7d8f018e5774325b658018c151cfa4c09f78341d
// Cryptographic source subset only: no keychain discovery or OS commands.
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
export type BundleSignature = {
  algorithm: "ed25519";
  publicKey: string;
  value: string;
  keySource: "keychain" | "ephemeral";
};
type SigningKeySource = BundleSignature["keySource"];
export interface SigningKey {
  readonly source: SigningKeySource;
  readonly publicKeySpki: string;
  sign(message: string | Uint8Array): string;
}
export function createEphemeralSigningKey(): SigningKey {
  const pair = generateKeyPairSync("ed25519");
  return keyFrom(pair.privateKey, "ephemeral");
}

export function signingKeyFromPkcs8(pkcs8Base64: string, source: SigningKeySource): SigningKey {
  const privateKey = createPrivateKey({
    key: Buffer.from(pkcs8Base64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return keyFrom(privateKey, source);
}

export function signChainHead(chainHead: string, key: SigningKey): BundleSignature {
  return {
    algorithm: "ed25519",
    publicKey: key.publicKeySpki,
    value: key.sign(chainHead),
    keySource: key.source,
  };
}

export function verifyChainHeadSignature(
  chainHead: string | Uint8Array,
  signature: BundleSignature,
): boolean {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(signature.publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    return verifyBytes(
      null,
      typeof chainHead === "string" ? Buffer.from(chainHead, "utf8") : chainHead,
      publicKey,
      Buffer.from(signature.value, "base64"),
    );
  } catch {
    return false;
  }
}

function keyFrom(privateKey: KeyObject, source: SigningKeySource): SigningKey {
  const publicKeySpki = createPublicKey(privateKey)
    .export({ type: "spki", format: "der" })
    .toString("base64");

  return {
    source,
    publicKeySpki,
    sign: (message) =>
      signBytes(
        null,
        typeof message === "string" ? Buffer.from(message, "utf8") : message,
        privateKey,
      ).toString("base64"),
  };
}
