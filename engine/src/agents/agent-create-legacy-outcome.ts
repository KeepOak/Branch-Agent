import type { LegacyMainSessionMigrationOutcome } from "../config/sessions/legacy-main-session-migration.contract.js";

/** Explains why creating the legacy main agent is still blocked by session migration. */
export function describeLegacySessionOutcome(outcome: LegacyMainSessionMigrationOutcome): string {
  const claims = (outcome.sourceKeys ?? []).map(
    (key, index) => `${outcome.paths?.[index] ?? outcome.paths?.[0] ?? "session store"}#${key}`,
  );
  switch (outcome.kind) {
    case "divergent-aliases":
    case "divergent-canonical":
      return `${outcome.kind} for ${outcome.canonicalKey ?? "the canonical session"}; preserved claims ${claims.join(", ") || "could not be reconciled"} must be quarantined`;
    case "legacy-json-store":
      return `legacy JSON session store ${outcome.paths?.join(", ") ?? "requires import"}`;
    case "store-unreadable":
      return `unreadable session store ${outcome.paths?.join(", ") ?? "unknown"}${outcome.detail ? ` (${outcome.detail})` : ""}`;
    case "migrated-in-place":
    case "migrated-cross-store":
    case "canonical-exists-identical":
      return `legacy claim ${claims.join(", ") || outcome.canonicalKey || "requires migration"}`;
    case "not-armed":
      return outcome.detail === "owner-unresolved"
        ? "legacy main sessions have no unambiguous configured owner; set agents.defaults.sessionStore.agentId to the intended live owner"
        : `legacy main session migration is not armed (${outcome.detail ?? "unknown reason"})`;
    case "no-legacy-rows":
      return "the current session-store layout has no matching completed migration ledger";
  }
  const unreachable: never = outcome.kind;
  return unreachable;
}
