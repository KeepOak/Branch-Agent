import { StartupMaintenanceRequiredError } from "../infra/startup-maintenance-required.js";

export class BranchAgentDatabaseMediaMigrationRequiredError extends StartupMaintenanceRequiredError {
  constructor(
    readonly pathname: string,
    readonly schemaVersion: number,
  ) {
    super(
      "agent-media",
      `Branch Agent agent database ${pathname} uses schema version ${schemaVersion}; run branch doctor --fix to migrate persisted media before using it.`,
    );
    this.name = "BranchAgentDatabaseMediaMigrationRequiredError";
  }
}
