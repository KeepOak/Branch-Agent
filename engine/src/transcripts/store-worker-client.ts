import { createSqliteWorkerWriteAdmission } from "../infra/sqlite-worker-store.js";
import type { BranchStateDatabaseOptions } from "../state/branch-state-db.js";
import type { BranchStateLeaseContext } from "../state/branch-state-lease-context.js";
import { runWithBranchStateLeaseWorker } from "../state/branch-state-lease-worker-operation.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import type { BranchStateWorkerOperations } from "../state/branch-state-worker-contract.js";
import { runBranchStateWorkerOperation } from "../state/branch-state-worker-store.js";
import { prepareTranscriptDateReader } from "./store-date-preparation.js";
import { TranscriptLibraryError } from "./store-read.js";
import type { TranscriptReadRequests } from "./store-worker-contract.js";
import type { TranscriptExportWriteKey } from "./store-worker.types.js";
import type { TranscriptWriteOperations } from "./store-write.worker-contract.js";

/** One captured database generation spans planning, filesystem work, and persistence. */
export function createTranscriptStoreOperation(
  options: Pick<BranchStateDatabaseOptions, "env" | "path" | "readOnly">,
  assertOwner?: () => void,
) {
  const context = captureBranchStateWorkerContext(options);
  const readOnly = options.readOnly;
  const assertCurrent = () => {
    context.admission.assertCurrent();
    assertOwner?.();
  };
  return {
    assertCurrent,
    databaseOptions: { env: context.environment, path: context.admission.databasePath, readOnly },
    async writeExport<Key extends TranscriptExportWriteKey>(
      type: Key,
      request: TranscriptWriteOperations[Key]["input"],
      lease: BranchStateLeaseContext,
    ): Promise<void> {
      const input = { ...structuredClone(request), readOnly };
      assertCurrent();
      await runWithBranchStateLeaseWorker(lease, context, (scope, identity) =>
        scope.execute<Key>({ type, input: { ...input, lease: identity } }),
      );
    },
    async read<Key extends keyof TranscriptReadRequests>(
      type: Key,
      request: BranchStateWorkerOperations[Key]["input"],
    ): Promise<TranscriptReadRequests[Key]["output"]> {
      const input = structuredClone(request);
      input.readOnly = readOnly;
      const preparation =
        type === "transcripts.readEntries"
          ? prepareTranscriptDateReader(assertCurrent, context.admission.databasePath)
          : { assertCurrent };
      const result = await runBranchStateWorkerOperation(
        context,
        (scope) => scope.execute<Key>({ type, input }),
        preparation,
      );
      preparation.assertCurrent();
      if (!result.ok) {
        throw new TranscriptLibraryError(
          result.error.type,
          result.error.message,
          result.error.maxBytes,
        );
      }
      return result.value;
    },
    async write<Key extends keyof TranscriptWriteOperations>(
      type: Key,
      request: TranscriptWriteOperations[Key]["input"],
      assertWriteOwner?: () => void,
    ): Promise<TranscriptWriteOperations[Key]["output"]> {
      const input = { ...structuredClone(request), readOnly };
      const assertWriteCurrent = () => {
        assertCurrent();
        assertWriteOwner?.();
      };
      return runBranchStateWorkerOperation(
        context,
        (scope) => scope.execute<Key>({ type, input }),
        {
          assertCurrent: assertWriteCurrent,
          createAdmission: createSqliteWorkerWriteAdmission(assertWriteCurrent, [
            context.admission.databasePath,
          ]),
        },
      );
    },
  };
}

export type TranscriptStoreOperation = ReturnType<typeof createTranscriptStoreOperation>;
