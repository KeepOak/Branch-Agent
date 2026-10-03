import { StartupMaintenanceRequiredError } from "../infra/startup-maintenance-required.js";

export const LEGACY_SKILL_WORKSHOP_COLLECTION_REVIEWS_INDEX =
  "idx_skill_workshop_collection_reviews_workspace_time";

type BranchStateDatabaseSchemaMigrationRequiredKind =
  | "agent-databases-composite-primary-key"
  | "audit-events-v2"
  | "legacy-cron-run-logs"
  | "legacy-workshop-review-index";

export class BranchStateDatabaseSchemaMigrationRequiredError extends StartupMaintenanceRequiredError {
  constructor(
    override readonly kind: BranchStateDatabaseSchemaMigrationRequiredKind,
    readonly pathname: string,
  ) {
    super(
      kind,
      `Branch Agent state database schema migration required (${kind}) at ${pathname}; run branch doctor --fix to migrate it.`,
    );
    this.name = "BranchStateDatabaseSchemaMigrationRequiredError";
  }
}

/** Runtime readers report malformed legacy state without entering repair mode. */
export function normalizeBranchStateSchemaReadError(error: unknown, pathname: string): unknown {
  if (
    error instanceof Error &&
    error.message.startsWith(
      `malformed database schema (${LEGACY_SKILL_WORKSHOP_COLLECTION_REVIEWS_INDEX})`,
    )
  ) {
    const required = new BranchStateDatabaseSchemaMigrationRequiredError(
      "legacy-workshop-review-index",
      pathname,
    );
    required.cause = error;
    return required;
  }
  return error;
}
