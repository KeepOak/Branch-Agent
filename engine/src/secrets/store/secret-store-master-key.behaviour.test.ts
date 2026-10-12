// Behaviour test for the port of elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:packages/auth/src/vault/master-key.ts (atlas SAFETY-0077); upstream has no test file for it.
import { describe, expect, it } from "vitest";
import type { KeychainCommandRunner } from "./secret-store-keychain-process.js";
import {
  defaultMasterKey,
  inMemoryMasterKey,
  isKeychainUnsafe,
  MasterKeyUnavailableError,
  osKeychainMasterKey,
  passphraseMasterKey,
  passphraseMasterKeyFromEnv,
} from "./secret-store-master-key.js";

const PASSPHRASE = "correct horse battery staple";
const failingKeychain: KeychainCommandRunner = () => ({
  status: 1,
  stdout: "boom",
  error: undefined,
});
const storedKeychain =
  (key: Buffer): KeychainCommandRunner =>
  () => ({ status: 0, stdout: key.toString("base64"), error: undefined });

describe("master key resolvers", () => {
  it("accepts only 32-byte in-memory keys", async () => {
    const key = Buffer.alloc(32, 7);
    await expect(inMemoryMasterKey(key).load()).resolves.toEqual(key);
    expect(() => inMemoryMasterKey(Buffer.alloc(16))).toThrow(MasterKeyUnavailableError);
  });

  it("derives a stable passphrase key per service and rejects short passphrases", async () => {
    const a = await passphraseMasterKey({ passphrase: PASSPHRASE, cost: 1024 }).load();
    const b = await passphraseMasterKey({ passphrase: PASSPHRASE, cost: 1024 }).load();
    const other = await passphraseMasterKey({
      passphrase: PASSPHRASE,
      cost: 1024,
      service: "x",
    }).load();
    expect(a).toHaveLength(32);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(other)).toBe(false);
    expect(() => passphraseMasterKey({ passphrase: "short" })).toThrow(/at least 12/);
    expect(passphraseMasterKeyFromEnv(undefined, {})).toBeNull();
  });

  it("treats headless Linux and the explicit opt-out as keychain-unsafe", () => {
    expect(isKeychainUnsafe({}, "linux")).toBe(true);
    expect(isKeychainUnsafe({ DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/bus" }, "linux")).toBe(
      false,
    );
    expect(isKeychainUnsafe({}, "darwin")).toBe(false);
    expect(isKeychainUnsafe({ BRANCH_VAULT_DISABLE_KEYCHAIN: "1" }, "win32")).toBe(true);
  });

  it("reads the OS keychain and names it", async () => {
    const key = Buffer.alloc(32, 9);
    const resolver = osKeychainMasterKey({ platform: "darwin", env: {}, run: storedKeychain(key) });
    await expect(resolver.load()).resolves.toEqual(key);
    expect(resolver.describe()).toBe("keychain://branch-agent/secrets.masterKey");
  });

  it("falls back to the passphrase only when the keychain fails, and never fabricates a key", async () => {
    const env = { BRANCH_VAULT_PASSPHRASE: PASSPHRASE };
    const fallback = defaultMasterKey({ platform: "darwin", env, run: failingKeychain });
    const expected = await passphraseMasterKey({ passphrase: PASSPHRASE }).load();
    await expect(fallback.load()).resolves.toEqual(expected);
    expect(fallback.describe()).toContain("fallback: passphrase://branch-agent");

    const none = defaultMasterKey({ platform: "darwin", env: {}, run: failingKeychain });
    await expect(none.load()).rejects.toThrow(/BRANCH_VAULT_PASSPHRASE/);
    await expect(none.load()).rejects.not.toThrow(/boom/);

    const headless = defaultMasterKey({ platform: "linux", env: {}, run: failingKeychain });
    await expect(headless.load()).rejects.toBeInstanceOf(MasterKeyUnavailableError);
    expect(headless.describe()).toContain("keychain bypassed");
  });
});
