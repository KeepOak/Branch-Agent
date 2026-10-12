import type { BranchStateWorkerContext } from "../state/branch-state-worker-context.types.js";
import type { CronReceiptAuthorityUse } from "./store/receipt-authority-owner.js";
import type { CronRunReceiptHandle } from "./store/run-receipt.types.js";

/** Process-local occurrence custody, never reconstructed from a run ID. */
export type CronStandingGrantAuthority = {
  context: BranchStateWorkerContext;
  handle: CronRunReceiptHandle;
  assertCurrent: () => void;
  acquireUse: (assertCurrent: () => void, signal?: AbortSignal) => Promise<CronReceiptAuthorityUse>;
};
