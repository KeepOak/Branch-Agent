import { digestOfJson, type JsonValue } from "./canonical-json.js";
import { signChainHead, verifyChainHeadSignature, type SigningKey, type BundleSignature } from "./signing.js";

/** Content digest with a source Ed25519 signature. This alone does not attest signer trust. */
export type SignedJsonReceipt = { digest: string; signature: BundleSignature };

/** Compose the source canonical content digest and source chain-head signing primitive. */
export function signJsonReceipt(payload: JsonValue, key: SigningKey): SignedJsonReceipt {
  const digest = digestOfJson(payload);
  return { digest, signature: signChainHead(digest, key) };
}

/** Checks content and cryptographic integrity; signer trust and ledger custody are separate. */
export function verifyJsonReceipt(payload: JsonValue, receipt: SignedJsonReceipt): boolean {
  return digestOfJson(payload) === receipt.digest && verifyChainHeadSignature(receipt.digest, receipt.signature);
}
