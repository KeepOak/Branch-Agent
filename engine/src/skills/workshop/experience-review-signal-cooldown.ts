import { createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { formatErrorMessage } from "../../infra/errors.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  type BranchStateDatabase,
  runBranchStateWriteTransaction,
} from "../../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../../state/branch-state-db.paths.js";
import { updateConfigMachineStateInDatabase } from "../../state/config-machine-state-write.js";

const log = createSubsystemLogger("skills/workshop");
const CLAIMS_STATE_KEY = "skills.experienceSignalClaims";
const KEY_FILENAME = "experience-signal-claims.key";
const KEY_BYTES = 32;
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
// The claim runs on the gateway thread, so it may wait only briefly for a lock.
const CLAIM_BUSY_TIMEOUT_MS = 50;
const CLAIM_OPERATION_LABEL = "skill-workshop.experience-signal.claim";
const keysByPath = new Map<string, Buffer>();

export type ExperienceSignalClaimInput = {
  agentId: string;
  /** Tool name plus command head. It is keyed and hashed before it is stored. */
  identity: string;
  nowMs: number;
};

type ExperienceSignalClaimsState = {
  /** HMAC digests mapped to the time each identity was claimed. */
  claims: Record<string, number>;
};

/**
 * Loads the per-install HMAC key from a file beside the state database. The file follows the
 * config-journal fingerprint key precedent: 32 random bytes, created with `wx` at mode 0600
 * in a 0700 directory. The key is never written to the database.
 */
function loadExperienceSignalKey(stateDir: string): Buffer {
  const keyPath = path.join(stateDir, KEY_FILENAME);
  const cached = keysByPath.get(keyPath);
  if (cached) {
    return cached;
  }
  let key: Buffer;
  try {
    key = fs.readFileSync(keyPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    const created = randomBytes(KEY_BYTES);
    try {
      const descriptor = fs.openSync(keyPath, "wx", 0o600);
      try {
        fs.writeFileSync(descriptor, created);
      } finally {
        fs.closeSync(descriptor);
      }
      key = created;
    } catch (createError) {
      if ((createError as NodeJS.ErrnoException).code !== "EEXIST") {
        throw createError;
      }
      key = fs.readFileSync(keyPath);
    }
  }
  if (key.length !== KEY_BYTES) {
    throw new Error("experience signal key file has the wrong length");
  }
  fs.chmodSync(keyPath, 0o600);
  keysByPath.set(keyPath, key);
  return key;
}

function claimDigest(key: Buffer, input: ExperienceSignalClaimInput): string {
  return createHmac("sha256", key).update(`${input.agentId}\0${input.identity}`).digest("hex");
}

function unexpiredClaims(claims: Record<string, number>, nowMs: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(claims).filter(([, claimedAtMs]) => nowMs - claimedAtMs < COOLDOWN_MS),
  );
}

/** Claims the identity for this agent. False while an unexpired claim exists. */
export function claimExperienceSignalInDatabase(
  database: BranchStateDatabase,
  key: Buffer,
  input: ExperienceSignalClaimInput,
): boolean {
  let claimed = false;
  updateConfigMachineStateInDatabase<ExperienceSignalClaimsState>(
    database.db,
    CLAIMS_STATE_KEY,
    (current) => {
      const claims = unexpiredClaims(current?.claims ?? {}, input.nowMs);
      const digest = claimDigest(key, input);
      claimed = claims[digest] === undefined;
      if (claimed) {
        claims[digest] = input.nowMs;
      }
      return { claims };
    },
    input.nowMs,
  );
  return claimed;
}

/**
 * Production claim for the scheduler. The key is read and cached before the transaction opens,
 * so the transaction holds only the lock. It is a bounded immediate transaction and fails
 * closed: a missing key, lock timeout or storage error means no review is scheduled, and the
 * warning sink receives a message.
 */
export function claimExperienceSignalCooldown(
  input: ExperienceSignalClaimInput,
  warn: (message: string) => void = (message) => log.warn(message),
): boolean {
  try {
    const key = loadExperienceSignalKey(path.dirname(resolveBranchStateSqlitePath(process.env)));
    return runBranchStateWriteTransaction(
      (database) => claimExperienceSignalInDatabase(database, key, input),
      {},
      { busyTimeoutMs: CLAIM_BUSY_TIMEOUT_MS, operationLabel: CLAIM_OPERATION_LABEL },
    );
  } catch (error) {
    warn(
      `experience review signal claim unavailable, no review scheduled: ${formatErrorMessage(error)}`,
    );
    return false;
  }
}
