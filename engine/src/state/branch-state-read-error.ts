import type {
  BranchStateReadOutcome,
  BranchStateReadPhase,
} from "./branch-state-read.types.js";

export type BranchStateReadReceipt = { phase: BranchStateReadPhase };

export function observeReadOutcome(
  receipt: BranchStateReadReceipt,
  outcome: BranchStateReadOutcome | undefined,
): void {
  if (!outcome) {
    return;
  }
  const admitted =
    "error" in outcome
      ? outcome.sourceAdmitted
      : outcome.value.type === "admit"
        ? undefined
        : outcome.value.sourceAdmitted;
  if (admitted === true) {
    receipt.phase = "read";
  } else if (admitted === false && receipt.phase !== "read") {
    receipt.phase = "before-read";
  }
}
