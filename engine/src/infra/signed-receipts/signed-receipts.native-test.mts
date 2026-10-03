import { describe, test as it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { registerHooks } from "node:module";
const expect = (actual: any) => ({
 toBe: (expected: any) => assert.equal(actual,expected),
 toEqual: (expected: any) => assert.deepEqual(actual,expected),
 toMatch: (pattern: RegExp) => assert.match(actual,pattern),
 toThrow: (type: any) => assert.throws(actual,type),
 not: {toBe: (expected: any) => assert.notEqual(actual,expected)},
});
// Node native execution maps only this directory's two normal .js source imports.
registerHooks({resolve(specifier,context,next) {
  if (context.parentURL?.includes("/signed-receipts/") &&
      (specifier === "./canonical-json.js" || specifier === "./signing.js"))
    return next(specifier.replace(/\.js$/, ".ts"),context);
  return next(specifier,context);
}});
const { createEphemeralSigningKey,signChainHead,signingKeyFromPkcs8,verifyChainHeadSignature } = await import("./signing.ts");
const { signJsonReceipt,verifyJsonReceipt } = await import("./receipt.ts");

import {
  asJsonValue,
  canonicalJson,
  digestFileName,
  digestOfBytes,
  digestOfJson,
  digestPattern,
  NonCanonicalValueError,
} from "./canonical-json.ts";

it("hashes raw bytes with the known SHA-256 vector without decoding malformed UTF-8", () => {
  expect(digestOfBytes(Uint8Array.of(97, 98, 99))).toBe(
    "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(digestOfBytes(Uint8Array.of(255))).not.toBe(digestOfBytes("\uFFFD"));
  expect(digestOfBytes(Buffer.from("é", "utf8"))).toBe(digestOfBytes("é"));
});

describe("canonicalJson", () => {
  it("orders keys so structurally equal payloads produce identical bytes", () => {
    const one = canonicalJson({ b: 1, a: { d: 4, c: 3 } });
    const other = canonicalJson({ a: { c: 3, d: 4 }, b: 1 });

    expect(one).toBe('{"a":{"c":3,"d":4},"b":1}');
    expect(one).toBe(other);
  });

  it("keeps array order, which is content, not formatting", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("treats an absent key and a present undefined key alike", () => {
    const withUndefined = { a: 1, b: undefined } as unknown as Record<string, never>;
    expect(canonicalJson(withUndefined)).toBe(canonicalJson({ a: 1 }));
  });

  it("refuses a value with no JSON form rather than silently writing null", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(NonCanonicalValueError);
    expect(() => canonicalJson({ ratio: Number.POSITIVE_INFINITY })).toThrow(
      NonCanonicalValueError,
    );
  });
});

describe("digests", () => {
  it("addresses identical content identically and different content differently", () => {
    expect(digestOfJson({ a: 1 })).toBe(digestOfJson({ a: 1 }));
    expect(digestOfJson({ a: 1 })).not.toBe(digestOfJson({ a: 2 }));
  });

  it("is a sha256 of the canonical bytes", () => {
    expect(digestOfJson({ a: 1 })).toBe(digestOfBytes('{"a":1}'));
    expect(digestOfJson({ a: 1 })).toMatch(digestPattern);
  });

  it("names a blob file after the digest without its algorithm prefix", () => {
    expect(digestFileName(`sha256:${"ab".repeat(32)}`)).toBe(`${"ab".repeat(32)}.json`);
  });
});

describe("asJsonValue", () => {
  it("keeps recordable values and drops undefined properties", () => {
    expect(asJsonValue({ path: "src/a.ts", limit: undefined, nested: [1, true, null] })).toEqual({
      path: "src/a.ts",
      nested: [1, true, null],
    });
  });

  it("records unrepresentable values as their type rather than losing the field", () => {
    expect(asJsonValue({ callback: () => 1, size: 10n })).toEqual({
      callback: "[function]",
      size: "10",
    });
  });

  it("converts a non-finite number to text so the payload stays canonical", () => {
    expect(canonicalJson(asJsonValue({ ratio: Number.NaN }))).toBe('{"ratio":"NaN"}');
  });
});

const chainHead = `sha256:${"c".repeat(64)}`;
describe("chain head signatures", () => {
  it("signs the head and verifies it back", () => {
    const signature = signChainHead(chainHead, createEphemeralSigningKey());

    expect(signature.algorithm).toBe("ed25519");
    expect(verifyChainHeadSignature(chainHead, signature)).toBe(true);
  });

  it("fails for any other head, which is what makes it tamper-evidence", () => {
    const signature = signChainHead(chainHead, createEphemeralSigningKey());

    expect(verifyChainHeadSignature(`sha256:${"d".repeat(64)}`, signature)).toBe(false);
  });

  it("fails when the signature or the key is swapped", () => {
    const signature = signChainHead(chainHead, createEphemeralSigningKey());
    const other = signChainHead(chainHead, createEphemeralSigningKey());

    expect(verifyChainHeadSignature(chainHead, { ...signature, value: other.value })).toBe(false);
    expect(verifyChainHeadSignature(chainHead, { ...signature, publicKey: other.publicKey })).toBe(
      false,
    );
    expect(verifyChainHeadSignature(chainHead, { ...signature, publicKey: "not-a-key" })).toBe(
      false,
    );
  });

  it("produces the same public key from the same stored private key", () => {
    const pkcs8 = generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "der" })
      .toString("base64");

    const first = signingKeyFromPkcs8(pkcs8, "keychain");
    const second = signingKeyFromPkcs8(pkcs8, "keychain");

    expect(second.publicKeySpki).toBe(first.publicKeySpki);
    expect(verifyChainHeadSignature(chainHead, signChainHead(chainHead, second))).toBe(true);
  });
});


describe("signed JSON receipt composition", () => {
 it("signs and verifies a real canonical payload without persisting keys", () => {
   const receipt=signJsonReceipt({b:2,a:1},createEphemeralSigningKey());
   assert.equal(receipt.signature.keySource,"ephemeral");
   assert.equal(verifyJsonReceipt({a:1,b:2},receipt),true);
 });
 it("rejects mutated payload, modified digest and signature", () => {
   const payload={action:"model-call",tokens:10};
   const receipt=signJsonReceipt(payload,createEphemeralSigningKey());
   assert.equal(verifyJsonReceipt({...payload,tokens:11},receipt),false);
   assert.equal(verifyJsonReceipt(payload,{...receipt,digest:`sha256:${"a".repeat(64)}`}),false);
   assert.equal(verifyJsonReceipt(payload,{...receipt,signature:{...receipt.signature,value:"invalid"}}),false);
 });
 it("does not mistake arbitrary retained signatures for the current payload", () => {
   const key=createEphemeralSigningKey();
   const first=signJsonReceipt({run:1},key),second=signJsonReceipt({run:2},key);
   assert.equal(verifyJsonReceipt({run:1},{...first,signature:second.signature}),false);
 });
});
