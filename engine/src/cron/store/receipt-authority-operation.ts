import { createSqliteWorkerOperationAdmission } from "../../infra/sqlite-worker-operation-admission.js";
import type { BranchStateWorkerContext } from "../../state/branch-state-worker-context.types.js";
import { runBranchStateWorkerOperation } from "../../state/branch-state-worker-store.js";
import type { DomainScope } from "../../state/branch-state-worker-store.types.js";
import { withCronReceiptAuthorityMutation } from "./receipt-authority-owner.js";

/** Store saves may perform several repair transactions within one retained operation. */
export function runCronStoreAuthorityOperation<T>(
  context: BranchStateWorkerContext,
  operation: (scope: DomainScope) => Promise<T>,
): Promise<T> {
  return withCronReceiptAuthorityMutation(context, (mutation) =>
    runBranchStateWorkerOperation(mutation.context, operation, {
      assertCurrent: mutation.assertCurrent,
      createAdmission(retained) {
        const admission = createSqliteWorkerOperationAdmission((_request, grant) => {
          mutation.assertCurrent();
          if (!grant()) {
            throw new Error("Cron store publication admission expired");
          }
        }, mutation.attachment);
        mutation.observe(admission, retained);
        return { admission, nativeLocations: [context.admission.databasePath] };
      },
    }),
  );
}
