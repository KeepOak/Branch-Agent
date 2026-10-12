// elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf:plugins/plugin-assistant/src/features/secrets/crypto/encryption.ts (atlas SAFETY-0077)
/**
 * Encryption module for secrets management
 *
 * Provides AES-256-GCM encryption with secure key derivation for protecting sensitive data.
 * Additional authenticated data (AAD) binds a ciphertext to its key id and the name it is
 * stored under, so a value cannot be swapped between entries (moeru-ai/airi).
 */

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  pbkdf2Sync,
  randomBytes,
  scryptSync,
} from "node:crypto";

// ============================================================================
// Types
// ============================================================================

/** Encrypted secret container. */
export interface EncryptedSecret {
  value: string;
  iv: string;
  authTag?: string;
  algorithm: "aes-256-gcm";
  keyId: string;
}

/** Key derivation parameters, stored next to password-derived keys. */
export interface KeyDerivationParams {
  salt: string;
  iterations: number;
  algorithm: "pbkdf2-sha256";
  keyLength: number;
}

export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionError";
  }
}

// ============================================================================
// Constants
// ============================================================================

const ALGORITHM_GCM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32; // 256 bits
const DEFAULT_SALT_LENGTH = 32;
const DEFAULT_PBKDF2_ITERATIONS = 100000;

// ============================================================================
// Key Derivation
// ============================================================================

/**
 * Generate a cryptographically secure random salt
 */
export function generateSalt(length = DEFAULT_SALT_LENGTH): string {
  return randomBytes(length).toString("base64");
}

/**
 * Generate a random encryption key
 */
export function generateKey(): Buffer {
  return randomBytes(KEY_LENGTH);
}

/**
 * Derive an encryption key from a password/passphrase using PBKDF2
 */
export function deriveKeyPbkdf2(
  password: string,
  salt: string | Buffer,
  iterations = DEFAULT_PBKDF2_ITERATIONS,
): Buffer {
  const saltBuffer = typeof salt === "string" ? Buffer.from(salt, "base64") : salt;
  return pbkdf2Sync(password, saltBuffer, iterations, KEY_LENGTH, "sha256");
}

/**
 * Derive an encryption key from a password using scrypt (more memory-hard)
 */
export function deriveKeyScrypt(password: string, salt: string | Buffer): Buffer {
  const saltBuffer = typeof salt === "string" ? Buffer.from(salt, "base64") : salt;
  return scryptSync(password, saltBuffer, KEY_LENGTH, {
    N: 16384,
    r: 8,
    p: 1,
  });
}

/**
 * Create key derivation parameters for storage
 */
export function createKeyDerivationParams(
  salt?: string,
  iterations = DEFAULT_PBKDF2_ITERATIONS,
): KeyDerivationParams {
  return {
    salt: salt ?? generateSalt(),
    iterations,
    algorithm: "pbkdf2-sha256",
    keyLength: KEY_LENGTH,
  };
}

// ============================================================================
// Encryption
// ============================================================================

function assertKeyLength(key: Buffer): void {
  if (key.length !== KEY_LENGTH) {
    throw new EncryptionError(`Invalid key length: expected ${KEY_LENGTH}, got ${key.length}`);
  }
}

function additionalData(keyId: string, aad: string): Buffer {
  return Buffer.from(`branch:secret:${keyId}\u0000${aad}`, "utf8");
}

/**
 * Encrypt a value using AES-256-GCM
 *
 * GCM mode provides both confidentiality and authenticity, making it the preferred
 * choice for encrypting secrets. The authentication tag prevents tampering.
 *
 * @param plaintext - The value to encrypt
 * @param key - The encryption key (32 bytes)
 * @param keyId - Identifier for the key (for rotation support)
 * @param aad - Optional context (for example the entry name) bound to the ciphertext
 * @returns Encrypted secret container
 */
export function encryptGcm(
  plaintext: string,
  key: Buffer,
  keyId = "default",
  aad?: string,
): EncryptedSecret {
  assertKeyLength(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM_GCM, key, iv);
  if (aad !== undefined) {
    cipher.setAAD(additionalData(keyId, aad));
  }
  let encrypted = cipher.update(plaintext, "utf8", "base64");
  encrypted += cipher.final("base64");
  const authTag = cipher.getAuthTag();
  return {
    value: encrypted,
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    algorithm: "aes-256-gcm",
    keyId,
  };
}

/**
 * Encrypt a value using the default algorithm (GCM)
 */
export function encrypt(
  plaintext: string,
  key: Buffer,
  keyId = "default",
  aad?: string,
): EncryptedSecret {
  return encryptGcm(plaintext, key, keyId, aad);
}

// ============================================================================
// Decryption
// ============================================================================

/**
 * Decrypt a value encrypted with AES-256-GCM
 *
 * @param encrypted - The encrypted secret container
 * @param key - The decryption key (32 bytes)
 * @param aad - The context the value was encrypted with, if any
 * @returns The decrypted plaintext
 */
export function decryptGcm(encrypted: EncryptedSecret, key: Buffer, aad?: string): string {
  assertKeyLength(key);
  if (encrypted.algorithm !== "aes-256-gcm") {
    throw new EncryptionError(
      `Algorithm mismatch: expected aes-256-gcm, got ${String(encrypted.algorithm)}`,
    );
  }
  if (!encrypted.authTag) {
    throw new EncryptionError("Missing authentication tag for GCM decryption");
  }
  const iv = Buffer.from(encrypted.iv, "base64");
  const authTag = Buffer.from(encrypted.authTag, "base64");
  const decipher = createDecipheriv(ALGORITHM_GCM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);
  if (aad !== undefined) {
    decipher.setAAD(additionalData(encrypted.keyId, aad));
  }
  let decrypted = decipher.update(encrypted.value, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Decrypt a value using the appropriate algorithm
 */
export function decrypt(encrypted: EncryptedSecret, key: Buffer, aad?: string): string {
  switch (encrypted.algorithm) {
    case "aes-256-gcm":
      return decryptGcm(encrypted, key, aad);
    default:
      throw new EncryptionError(`Unsupported algorithm: ${String(encrypted.algorithm)}`);
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a value appears to be an encrypted secret
 */
export function isEncryptedSecret(value: unknown): value is EncryptedSecret {
  if (!value || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.value === "string" &&
    typeof obj.iv === "string" &&
    typeof obj.algorithm === "string" &&
    obj.algorithm === "aes-256-gcm"
  );
}

/**
 * Generate a secure random string for tokens, IDs, etc.
 */
export function generateSecureToken(length = 32): string {
  return randomBytes(length).toString("hex");
}

/**
 * Hash a value for comparison or fingerprinting (not for passwords)
 */
export function hashValue(value: string, algorithm: "sha256" | "sha512" = "sha256"): string {
  return createHash(algorithm).update(value).digest("hex");
}

/**
 * Securely compare two strings in constant time to prevent timing attacks
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= (bufA[i] ?? 0) ^ (bufB[i] ?? 0);
  }
  return result === 0;
}

// ============================================================================
// Key Manager Class
// ============================================================================

/**
 * Manages encryption keys with support for rotation and multiple key IDs
 */
export class KeyManager {
  private keys: Map<string, Buffer> = new Map();
  private currentKeyId = "default";
  private derivationParams: KeyDerivationParams | null = null;

  constructor(options?: {
    primaryKey?: Buffer;
    primaryKeyId?: string;
    derivationParams?: KeyDerivationParams;
  }) {
    if (options?.primaryKey) {
      const keyId = options.primaryKeyId ?? "default";
      this.keys.set(keyId, options.primaryKey);
      this.currentKeyId = keyId;
    }
    if (options?.derivationParams) {
      this.derivationParams = options.derivationParams;
    }
  }

  /** Initialize with a password-derived key */
  initializeFromPassword(password: string, salt?: string): void {
    this.derivationParams = createKeyDerivationParams(salt);
    const key = deriveKeyPbkdf2(
      password,
      this.derivationParams.salt,
      this.derivationParams.iterations,
    );
    this.keys.set("default", key);
    this.currentKeyId = "default";
  }

  /** Add a key for decryption (supports key rotation) */
  addKey(keyId: string, key: Buffer): void {
    this.keys.set(keyId, key);
  }

  /** Set the current key for encryption */
  setCurrentKey(keyId: string): void {
    if (!this.keys.has(keyId)) {
      throw new EncryptionError(`Key not found: ${keyId}`);
    }
    this.currentKeyId = keyId;
  }

  /** Get the current key ID */
  getCurrentKeyId(): string {
    return this.currentKeyId;
  }

  /** Get a key by ID */
  getKey(keyId: string): Buffer | undefined {
    return this.keys.get(keyId);
  }

  /** Get the current encryption key */
  getCurrentKey(): Buffer {
    const key = this.keys.get(this.currentKeyId);
    if (!key) {
      throw new EncryptionError("No encryption key configured");
    }
    return key;
  }

  /** Get derivation parameters (for storage) */
  getDerivationParams(): KeyDerivationParams | null {
    return this.derivationParams;
  }

  /** Encrypt a value with the current key */
  encrypt(plaintext: string, aad?: string): EncryptedSecret {
    return encryptGcm(plaintext, this.getCurrentKey(), this.currentKeyId, aad);
  }

  /** Decrypt a value (automatically selects the correct key) */
  decrypt(encrypted: EncryptedSecret, aad?: string): string {
    const key = this.keys.get(encrypted.keyId);
    if (!key) {
      throw new EncryptionError(`Key not found for decryption: ${encrypted.keyId}`);
    }
    return decrypt(encrypted, key, aad);
  }

  /** Re-encrypt a value with the current key (for key rotation) */
  reencrypt(encrypted: EncryptedSecret, aad?: string): EncryptedSecret {
    const plaintext = this.decrypt(encrypted, aad);
    return this.encrypt(plaintext, aad);
  }

  /** Clear all keys from memory */
  clear(): void {
    // Overwrite key buffers before clearing
    for (const key of this.keys.values()) {
      key.fill(0);
    }
    this.keys.clear();
  }
}

export { ALGORITHM_GCM, DEFAULT_PBKDF2_ITERATIONS, DEFAULT_SALT_LENGTH, IV_LENGTH, KEY_LENGTH };
