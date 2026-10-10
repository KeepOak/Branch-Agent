import { createHmac, randomBytes } from "node:crypto";
import { formatErrorMessage } from "../../infra/errors.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  type BranchStateDatabase,
  runBranchStateWriteTransaction,
} from "../../state/branch-state-db.js";
import { updateConfigMachineStateInDatabase } from "../../state/config-machine-state-write.js";

const log = createSubsystemLogger("skills/workshop");
const CLAIMS_STATE_KEY = "skills.experienceSignalClaims";
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
// The claim runs on the gateway thread, so it may wait only briefly for a lock.
const CLAIM_BUSY_TIMEOUT_MS = 50;
const CLAIM_OPERATION_LABEL = "skill-workshop.experience-signal.claim";

export type ExperienceSignalClaimInput = {
  agentId: string;
  /** Tool name plus command head. It is hashed before it is stored. */
  identity: string;
  nowMs: number;
};

type ExperienceSignalClaimsState = {
  /** Per-install HMAC key, generated once and kept only in this row. */
  secret: string;
  /** HMAC keys mapped to the time each identity was claimed. */
  claims: Record<string, number>;
};

function claimKey(secret: string, input: ExperienceSignalClaimInput): string {
  return createHmac("sha256", Buffer.from(secret, "hex"))
    .update(`${input.agentId}\0${input.identity}`)
    .digest("hex");
}

function unexpiredClaims(claims: Record<string, number>, nowMs: number): Record<string, number> {
  return Object.fromEntries(
    Object.entries(claims).filter(([, claimedAtMs]) => nowMs - claimedAtMs < COOLDOWN_MS),
  );
}

/** Claims the identity for this agent. False while an unexpired claim exists. */
export function claimExperienceSignalInDatabase(
  database: BranchStateDatabase,
  input: ExperienceSignalClaimInput,
): boolean {
  let claimed = false;
  updateConfigMachineStateInDatabase<ExperienceSignalClaimsState>(
    database.db,
    CLAIMS_STATE_KEY,
    (current) => {
      const secret = current?.secret ?? randomBytes(32).toString("hex");
      const claims = unexpiredClaims(current?.claims ?? {}, input.nowMs);
      const key = claimKey(secret, input);
      claimed = claims[key] === undefined;
      if (claimed) {
        claims[key] = input.nowMs;
      }
      return { secret, claims };
    },
    input.nowMs,
  );
  return claimed;
}

/**
 * Production claim for the scheduler. It is a bounded immediate transaction and fails
 * closed: any lock timeout or storage error means no review is scheduled, and it is logged.
 */
export function claimExperienceSignalCooldown(input: ExperienceSignalClaimInput): boolean {
  try {
    return runBranchStateWriteTransaction(
      (database) => claimExperienceSignalInDatabase(database, input),
      {},
      { busyTimeoutMs: CLAIM_BUSY_TIMEOUT_MS, operationLabel: CLAIM_OPERATION_LABEL },
    );
  } catch (error) {
    log.warn(
      `experience review signal claim unavailable, no review scheduled: ${formatErrorMessage(error)}`,
    );
    return false;
  }
}
