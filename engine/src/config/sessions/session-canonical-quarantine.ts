import {
  clearBranchSessionRowQuarantines,
  recordBranchSessionRowQuarantines,
} from "../../state/branch-session-row-quarantine.js";
import type { CanonicalSessionCertificationHooks } from "./session-canonical-validation.js";

/** Quarantine invalid rows for one agent database during canonical certification. */
export function createCanonicalSessionQuarantineHooks(
  database: { agentId: string; path: string; env?: NodeJS.ProcessEnv },
  onQuarantined: (count: number) => void,
): CanonicalSessionCertificationHooks {
  return {
    quarantine: (rows) => {
      try {
        recordBranchSessionRowQuarantines({
          env: database.env,
          databasePath: database.path,
          agentId: database.agentId,
          rows: rows.map(({ row, reason }) => ({ sessionKey: row.session_key, reason, row })),
        });
      } catch (error) {
        // Without a durable record the row cannot be set aside; refuse as before.
        const refusal = rows[0]?.error;
        if (!refusal) {
          throw error;
        }
        refusal.cause ??= error;
        throw refusal;
      }
      onQuarantined(rows.length);
    },
    onCertified: (sessionKeys) => {
      try {
        clearBranchSessionRowQuarantines({
          env: database.env,
          databasePath: database.path,
          sessionKeys,
        });
      } catch {
        // A stale record only over-reports a repaired row; certification still stands.
      }
    },
  };
}
