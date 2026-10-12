// elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:plugins/plugin-assistant/src/features/secrets/crypto/encryption.test.ts (atlas SAFETY-0077)
/**
 * Core secrets encryption (AES-256-GCM). The security guarantees pinned here:
 * a correct round-trip, authenticated decryption that rejects a wrong key or
 * tampered ciphertext/algorithm, deterministic password-based key derivation,
 * and a length-checked constant-time string comparison.
 */

import { describe, expect, it } from "vitest";
import {
  type EncryptedSecret,
  EncryptionError,
  KeyManager,
  decrypt,
  decryptGcm,
  deriveKeyPbkdf2,
  deriveKeyScrypt,
  encrypt,
  encryptGcm,
  generateKey,
  generateSalt,
  generateSecureToken,
  hashValue,
  isEncryptedSecret,
  secureCompare,
} from "./secret-store-encryption.js";

const KEY = generateKey();

describe("key + salt generation", () => {
  it("generateKey yields 32 bytes; deriveKey* are deterministic per (password,salt)", () => {
    expect(KEY.length).toBe(32);
    const salt = generateSalt();
    const a = deriveKeyPbkdf2("hunter2", salt);
    const b = deriveKeyPbkdf2("hunter2", salt);
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(true);
    // Different password → different key.
    expect(a.equals(deriveKeyPbkdf2("other", salt))).toBe(false);
    // scrypt is also deterministic and 32 bytes.
    const s1 = deriveKeyScrypt("hunter2", salt);
    expect(s1.length).toBe(32);
    expect(s1.equals(deriveKeyScrypt("hunter2", salt))).toBe(true);
  });
});

describe("encrypt / decrypt round-trip", () => {
  it("recovers the plaintext and uses a fresh IV each time", () => {
    const a = encrypt("s3cr3t", KEY);
    const b = encrypt("s3cr3t", KEY);
    expect(a.algorithm).toBe("aes-256-gcm");
    expect(a.iv).not.toBe(b.iv); // fresh IV
    expect(a.value).not.toBe(b.value);
    expect(decrypt(a, KEY)).toBe("s3cr3t");
    expect(decrypt(b, KEY)).toBe("s3cr3t");
  });

  it("rejects a wrong-length key on encrypt and decrypt", () => {
    expect(() => encryptGcm("x", Buffer.alloc(16))).toThrow(EncryptionError);
    const enc = encrypt("x", KEY);
    expect(() => decryptGcm(enc, Buffer.alloc(16))).toThrow(EncryptionError);
  });
});

describe("authenticated decryption", () => {
  const enc = encrypt("payload", KEY);

  it("fails with a wrong key", () => {
    expect(() => decrypt(enc, generateKey())).toThrow();
  });

  it("fails on a tampered ciphertext", () => {
    const tampered: EncryptedSecret = {
      ...enc,
      value: encrypt("different", KEY).value,
    };
    expect(() => decryptGcm(tampered, KEY)).toThrow();
  });

  it("rejects a missing auth tag or mismatched algorithm", () => {
    expect(() => decryptGcm({ ...enc, authTag: undefined }, KEY)).toThrow(/authentication tag/);
    expect(() =>
      decrypt({ ...enc, algorithm: "aes-128-cbc" } as unknown as EncryptedSecret, KEY),
    ).toThrow(/Unsupported algorithm/);
  });
});

describe("isEncryptedSecret", () => {
  it("recognizes the envelope shape", () => {
    expect(isEncryptedSecret(encrypt("x", KEY))).toBe(true);
    expect(isEncryptedSecret({ value: "x", iv: "y", algorithm: "rot13" })).toBe(false);
    expect(isEncryptedSecret(null)).toBe(false);
    expect(isEncryptedSecret("string")).toBe(false);
  });
});

describe("hashValue / generateSecureToken / secureCompare", () => {
  it("hashValue is a stable hex digest sensitive to input", () => {
    expect(hashValue("a")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashValue("a")).not.toBe(hashValue("b"));
    expect(hashValue("a", "sha512")).toMatch(/^[0-9a-f]{128}$/);
  });

  it("generateSecureToken returns the requested byte length as hex", () => {
    expect(generateSecureToken(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(generateSecureToken(16)).not.toBe(generateSecureToken(16));
  });

  it("secureCompare matches equal strings and rejects unequal/length-mismatched", () => {
    expect(secureCompare("abc", "abc")).toBe(true);
    expect(secureCompare("abc", "abd")).toBe(false);
    expect(secureCompare("abc", "abcd")).toBe(false);
  });
});

// moeru-ai/airi: the key id and the entry name are bound as additional authenticated data.
describe("additional authenticated data", () => {
  it("decrypts only with the same entry name and key id", () => {
    const enc = encrypt("payload", KEY, "v2", "OPENAI_API_KEY");
    expect(decrypt(enc, KEY, "OPENAI_API_KEY")).toBe("payload");
    expect(() => decrypt(enc, KEY, "GITHUB_TOKEN")).toThrow();
    expect(() => decrypt(enc, KEY)).toThrow();
    expect(() => decrypt({ ...enc, keyId: "v3" }, KEY, "OPENAI_API_KEY")).toThrow();
  });
});

// elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:plugins/plugin-assistant/src/features/secrets/services/secrets-key-derivation.test.ts
describe("KeyManager rotation", () => {
  it("writes under the current key and still decrypts legacy ciphertext", () => {
    const legacyManager = new KeyManager();
    legacyManager.initializeFromPassword("agent-id", "unit-test-salt");
    const legacyCiphertext = legacyManager.encrypt("legacy-secret");
    expect(legacyCiphertext.keyId).toBe("default");

    const manager = new KeyManager();
    manager.initializeFromPassword("agent-id", "unit-test-salt");
    const strongKey = deriveKeyPbkdf2("unit-test-salt", Buffer.from("branch:secrets:v2", "utf8"));
    manager.addKey("v2", strongKey);
    manager.setCurrentKey("v2");

    const encrypted = manager.encrypt("sk-live-value");
    expect(encrypted.keyId).toBe("v2");
    expect(manager.decrypt(encrypted)).toBe("sk-live-value");
    expect(manager.decrypt(legacyCiphertext)).toBe("legacy-secret");
    expect(manager.reencrypt(legacyCiphertext).keyId).toBe("v2");
    expect(() => manager.setCurrentKey("missing")).toThrow(EncryptionError);
    manager.clear();
    expect(() => manager.getCurrentKey()).toThrow(/No encryption key configured/);
  });
});
