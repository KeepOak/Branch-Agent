import type { CronReceiptAuthorityAttachment } from "../cron/store/receipt-authority.types.js";
import { runWithSqliteWorkerStateContext } from "../infra/sqlite-worker-state-context.js";
import { openBranchStateDatabase } from "../state/branch-state-db.js";
import type { BranchStateWorkerContext } from "../state/branch-state-worker-context.types.js";
import {
  operatorApprovalOperations,
  type OperatorApprovalCommitReceipt,
} from "./operator-approval-store.operations.js";
import type { OperatorApprovalWorkerOperations } from "./operator-approval-store.worker-contract.js";

const operations: {
  [Key in keyof OperatorApprovalWorkerOperations]: (
    input: OperatorApprovalWorkerOperations[Key]["input"],
    context: Parameters<(typeof operatorApprovalOperations)[Key]>[1],
  ) => OperatorApprovalWorkerOperations[Key]["output"];
} = operatorApprovalOperations;

// Retain the v2026.9.4 opaque SDK commit guard beside the same native transaction.
// Remove this branch only when that SDK contract can require a worker-safe guard.
export function executeNativeOperatorApproval<Key extends keyof OperatorApprovalWorkerOperations>(
  type: Key,
  input: OperatorApprovalWorkerOperations[Key]["input"],
  context: BranchStateWorkerContext,
  assertCurrent: () => void,
  receiptAuthority: CronReceiptAuthorityAttachment,
  onCommitted: (receipt: OperatorApprovalCommitReceipt) => void,
): OperatorApprovalWorkerOperations[Key]["output"] {
  context.admission.assertCurrent();
  return runWithSqliteWorkerStateContext(context, () => {
    const options = { env: context.environment, path: context.admission.databasePath };
    return operations[type](input, {
      open: () => openBranchStateDatabase(options),
      stateOptions: () => options,
      native: { assertCurrent, receiptAuthority, onCommitted },
    });
  });
}
