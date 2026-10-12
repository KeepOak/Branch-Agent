import { note } from "../../packages/terminal-core/src/note.js";
import { repairBranchAgentDatabasePathAliases } from "../state/branch-agent-db-path-repair.js";
import { invalidateRegisteredAgentDatabasesMemo } from "../state/branch-agent-db-registry-listing.js";
import { runBranchStateWriteTransaction } from "../state/branch-state-db.js";
import { isUpdateDoctorLintPass } from "./doctor/shared/update-phase.js";

/** Repair inventory aliases only before an updater captures its exact-path baseline. */
export function noteDoctorAgentDatabasePathHealth(params: {
  env: NodeJS.ProcessEnv;
  shouldRepair: boolean;
}): string[] {
  if (!params.shouldRepair || process.platform !== "win32") {
    return [];
  }
  const report = runBranchStateWriteTransaction(
    (database) =>
      isUpdateDoctorLintPass(params.env)
        ? {
            repaired: 0,
            warnings: [
              "Skipped agent database path repair during update Doctor. Run branch doctor --fix after the update finishes.",
            ],
          }
        : repairBranchAgentDatabasePathAliases(database),
    { env: params.env },
    { operationLabel: "doctor.agent-database-paths" },
  );
  if (report.repaired > 0) {
    invalidateRegisteredAgentDatabasesMemo({ env: params.env });
    note(
      `Repaired ${report.repaired} agent database path registration(s), preserving the newest facts.`,
      "Doctor changes",
    );
  }
  if (report.warnings.length > 0) {
    note(report.warnings.join("\n"), "Doctor warnings");
  }
  return report.warnings;
}
