// elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:packages/auth/src/vault/master-key.ts (atlas SAFETY-0077)
/**
 * Master-key resolvers for secret encryption.
 *
 * Supports OS keychain storage, passphrase-derived keys and in-memory test keys.
 * Upstream's attestation-bound (TEE) resolver is not ported: Branch has no
 * confidential-compute deployment to verify evidence against.
 *
 * Resolvers, ordered by preference for defaultMasterKey():
 *
 *   1. OS keychain: Windows DPAPI (current user), the macOS login Keychain, or the
 *      Linux Secret Service (secret-store-keychain-process.ts).
 *   2. Passphrase: scrypt-derived 32-byte key from BRANCH_VAULT_PASSPHRASE with a
 *      per-service salt, for headless hosts where no keychain is reachable. The
 *      operator opts in by setting the env var; there is no hard-coded fallback.
 *   3. In-memory: inMemoryMasterKey(buffer). Tests only.
 */

import { scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  readKeychainKeySync,
  type KeychainProcessOptions,
} from "./secret-store-keychain-process.js";

const KEY_BYTES = 32;

export interface MasterKeyResolver {
  load(): Promise<Buffer>;
  describe(): string;
}

export class MasterKeyUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterKeyUnavailableError";
  }
}

export function inMemoryMasterKey(key: Buffer): MasterKeyResolver {
  if (key.length !== KEY_BYTES) {
    throw new MasterKeyUnavailableError(
      `inMemoryMasterKey: expected ${KEY_BYTES} bytes, got ${key.length}`,
    );
  }
  return {
    async load() {
      return key;
    },
    describe() {
      return "inMemory";
    },
  };
}

export interface OsKeychainOptions extends Pick<KeychainProcessOptions, "windowsKeyFile" | "run"> {
  /** Service name shown in the OS keychain UI. Default: "branch-agent". */
  readonly service?: string;
  /** Account name within the service. Default: "secrets.masterKey". */
  readonly account?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}

export interface PassphraseOptions {
  /** At least 12 characters; shorter passphrases are rejected. */
  readonly passphrase: string;
  /** Salt for the scrypt KDF. Default: derived from the service identifier. */
  readonly salt?: string;
  /** scrypt cost. Default 2^15. */
  readonly cost?: number;
  /** Service identifier used as the default salt prefix. Default "branch-agent". */
  readonly service?: string;
}

const PASSPHRASE_MIN_LENGTH = 12;
const DEFAULT_SCRYPT_COST = 1 << 15;
const DEFAULT_SCRYPT_BLOCK_SIZE = 8;
const DEFAULT_SCRYPT_PARALLELIZATION = 1;
const DEFAULT_SERVICE = "branch-agent";
const DEFAULT_ACCOUNT = "secrets.masterKey";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function derivePassphraseKey(passphrase: string, salt: string, cost: number): Buffer {
  // N=32_768 r=8 needs ~32MB, exactly Node's default maxmem cap, which OpenSSL
  // rejects with MEMORY_LIMIT_EXCEEDED. Raise the cap to 64MB.
  return scryptSync(passphrase, salt, KEY_BYTES, {
    N: cost,
    r: DEFAULT_SCRYPT_BLOCK_SIZE,
    p: DEFAULT_SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  });
}

/**
 * Master key derived from a passphrase via scrypt. The same passphrase, salt and
 * cost always produce the same key, so the passphrase must stay stable.
 */
export function passphraseMasterKey(opts: PassphraseOptions): MasterKeyResolver {
  if (typeof opts.passphrase !== "string") {
    throw new MasterKeyUnavailableError("passphraseMasterKey: passphrase must be a string");
  }
  if (opts.passphrase.length < PASSPHRASE_MIN_LENGTH) {
    throw new MasterKeyUnavailableError(
      `passphraseMasterKey: passphrase must be at least ${PASSPHRASE_MIN_LENGTH} characters`,
    );
  }
  const service = opts.service ?? DEFAULT_SERVICE;
  const salt = opts.salt ?? `${service}.vault.masterKey.v1`;
  const cost = opts.cost ?? DEFAULT_SCRYPT_COST;
  return {
    async load() {
      try {
        return derivePassphraseKey(opts.passphrase, salt, cost);
      } catch (err) {
        throw new MasterKeyUnavailableError(
          `passphraseMasterKey: scrypt derivation failed: ${errorText(err)}`,
        );
      }
    },
    describe() {
      return `passphrase://${service}`;
    },
  };
}

/** Passphrase resolver from BRANCH_VAULT_PASSPHRASE, or null when it is unset. */
export function passphraseMasterKeyFromEnv(
  service?: string,
  env: NodeJS.ProcessEnv = process.env,
): MasterKeyResolver | null {
  const raw = env.BRANCH_VAULT_PASSPHRASE;
  if (!raw || raw.length === 0) {
    return null;
  }
  return passphraseMasterKey({ passphrase: raw, ...(service ? { service } : {}) });
}

/**
 * Hosts where the keychain cannot be reached: explicit opt-out through
 * BRANCH_VAULT_DISABLE_KEYCHAIN=1, or headless Linux with no D-Bus session
 * (no DBUS_SESSION_BUS_ADDRESS and no $XDG_RUNTIME_DIR/bus socket).
 */
export function isKeychainUnsafe(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (env.BRANCH_VAULT_DISABLE_KEYCHAIN === "1") {
    return true;
  }
  if (platform !== "linux") {
    return false;
  }
  if (env.DBUS_SESSION_BUS_ADDRESS) {
    return false;
  }
  const xdgRuntime = env.XDG_RUNTIME_DIR;
  return !(xdgRuntime && existsSync(join(xdgRuntime, "bus")));
}

function keychainUnsafeMessage(prefix: string): string {
  return `${prefix}OS keychain is unavailable on this host (headless Linux with no reachable D-Bus session, or BRANCH_VAULT_DISABLE_KEYCHAIN=1). Set BRANCH_VAULT_PASSPHRASE (at least ${PASSPHRASE_MIN_LENGTH} characters) to use a passphrase-derived master key.`;
}

export function osKeychainMasterKey(opts: OsKeychainOptions = {}): MasterKeyResolver {
  const service = opts.service ?? DEFAULT_SERVICE;
  const account = opts.account ?? DEFAULT_ACCOUNT;
  return {
    async load() {
      if (isKeychainUnsafe(opts.env, opts.platform)) {
        throw new MasterKeyUnavailableError(
          keychainUnsafeMessage(`OS keychain (${service}/${account}): `),
        );
      }
      try {
        return readKeychainKeySync(service, account, {
          platform: opts.platform,
          windowsKeyFile: opts.windowsKeyFile,
          run: opts.run,
        });
      } catch (error) {
        throw new MasterKeyUnavailableError(errorText(error) || "OS keychain unavailable");
      }
    },
    describe() {
      return `keychain://${service}/${account}`;
    },
  };
}

async function loadPassphraseAfterKeychainFailure(
  keychainErr: unknown,
  passphrase: MasterKeyResolver | null,
): Promise<Buffer> {
  if (!passphrase) {
    throw new MasterKeyUnavailableError(
      `vault master key unavailable. ${errorText(keychainErr)} To use a passphrase-derived key on a headless host, set BRANCH_VAULT_PASSPHRASE (at least ${PASSPHRASE_MIN_LENGTH} characters) and restart.`,
    );
  }
  try {
    return await passphrase.load();
  } catch (passphraseErr) {
    throw new MasterKeyUnavailableError(
      `vault master key unavailable. Keychain: ${errorText(keychainErr)}. Passphrase: ${errorText(passphraseErr)}.`,
    );
  }
}

/**
 * Default resolver: the OS keychain first, then a passphrase-derived key from
 * BRANCH_VAULT_PASSPHRASE. If both fail it throws one MasterKeyUnavailableError
 * naming every remediation. No path returns a fabricated or default key.
 */
export function defaultMasterKey(opts: OsKeychainOptions = {}): MasterKeyResolver {
  const keychain = osKeychainMasterKey(opts);
  const passphrase = () => passphraseMasterKeyFromEnv(opts.service, opts.env);
  return {
    async load() {
      if (isKeychainUnsafe(opts.env, opts.platform)) {
        const fallback = passphrase();
        if (fallback) {
          return fallback.load();
        }
        throw new MasterKeyUnavailableError(keychainUnsafeMessage("vault: "));
      }
      try {
        return await keychain.load();
      } catch (keychainErr) {
        return loadPassphraseAfterKeychainFailure(keychainErr, passphrase());
      }
    },
    describe() {
      const fallback = passphrase();
      if (isKeychainUnsafe(opts.env, opts.platform)) {
        return fallback
          ? `${fallback.describe()} (keychain bypassed: host unsafe)`
          : "unavailable (keychain bypassed: host unsafe; no BRANCH_VAULT_PASSPHRASE set)";
      }
      return fallback
        ? `${keychain.describe()} (fallback: ${fallback.describe()})`
        : keychain.describe();
    },
  };
}
