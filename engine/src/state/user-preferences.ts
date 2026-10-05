import { isDeepStrictEqual } from "node:util";
import { isRecord } from "@branch/normalization-core/record-coerce";
import type { Result } from "@branch/normalization-core/result";
import { createSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import { executeExistingBranchStateRead } from "./branch-state-db-readonly.js";
import type { BranchStateDatabaseOptions } from "./branch-state-db.js";
import { captureBranchStateWorkerContext } from "./branch-state-worker-context.js";
import {
  executeBranchStateWorker,
  runBranchStateWorkerOperation,
} from "./branch-state-worker-store.js";
import {
  beginUserPreferenceMutation,
  captureUserPreferenceRead,
} from "./user-preferences-publication.js";
import { updatesGitCoauthorPreference } from "./user-preferences.store.js";
import type {
  CanonicalUserPreferences,
  UserPreferenceCoauthorMutation,
  UserPreferenceError,
} from "./user-preferences.types.js";
import { prepareUserPreferenceUpdate } from "./user-preferences.validation.js";
import { fenceUserProfileMutationAuthority } from "./user-profile-events.js";

/** Read one preference for a canonical profile batch without opening SQLite on the caller. */
export async function getUserPreferenceValues(
  profileIds: readonly string[],
  key: string,
  options: BranchStateDatabaseOptions = {},
): Promise<{ values: Map<string, unknown>; isCurrent: () => boolean }> {
  if (profileIds.length === 0) {
    return { values: new Map(), isCurrent: () => true };
  }
  const ids = [...new Set(profileIds)];
  const context = captureBranchStateWorkerContext(options);
  const isCurrent = await captureUserPreferenceRead(context.admission);
  const reply = await executeExistingBranchStateRead(
    { path: context.admission.databasePath, env: context.environment },
    { type: "userPreferences.values", profileIds: ids, key },
    { context, current: true },
  );
  if (reply && (!reply.ok || reply.type !== "userPreferences.values")) {
    throw new Error(reply.ok ? "Unexpected user preference values reply" : reply.message);
  }
  return { values: reply?.values ?? new Map(), isCurrent };
}

export function getCanonicalUserPreferences(
  profileId: string,
  keys?: readonly string[],
  options: Pick<BranchStateDatabaseOptions, "path" | "env"> = {},
): Promise<CanonicalUserPreferences | undefined> {
  return executeBranchStateWorker(captureBranchStateWorkerContext(options), {
    type: "userPreferences.read",
    input: { profileId, keys },
  });
}

export async function setCanonicalUserPreferences(
  profileId: string,
  entries: Record<string, unknown>,
  options: Pick<BranchStateDatabaseOptions, "path" | "env"> & {
    assertCurrent?: () => void;
    expectedEntries?: Record<string, unknown>;
  } = {},
): Promise<Result<{ profileId: string }, UserPreferenceError> | undefined> {
  const prepared = prepareUserPreferenceUpdate(entries, options.expectedEntries);
  if (!prepared.ok) {
    return prepared;
  }
  const context = captureBranchStateWorkerContext(options);
  const finishMutation = beginUserPreferenceMutation(context.admission);
  let publicationSettled: Promise<void> | undefined;
  try {
    return await runBranchStateWorkerOperation(
      context,
      (scope) =>
        scope.execute({
          type: "userPreferences.write",
          input: { profileId, update: prepared.value },
        }),
      {
        assertCurrent: options.assertCurrent,
        createAdmission: (operation) => {
          let stage: "transaction" | "commit" | "complete" = "transaction";
          let pending:
            | {
                facts: UserPreferenceCoauthorMutation;
                fence: ReturnType<typeof fenceUserProfileMutationAuthority>;
                granted: boolean;
              }
            | undefined;
          const admission = createSqliteWorkerOperationAdmission((request, grant) => {
            context.admission.assertCurrent();
            options.assertCurrent?.();
            if (
              stage === "transaction" &&
              request.stage === "transaction" &&
              request.facts === undefined
            ) {
              stage = "commit";
              grant();
              return;
            }
            if (stage !== "commit" || request.stage !== "commit") {
              throw new Error("Profile preference mutation requires transaction admission");
            }
            stage = "complete";
            if (request.facts === undefined) {
              grant();
              return;
            }
            if (
              !updatesGitCoauthorPreference(prepared.value) ||
              !isRecord(request.facts) ||
              request.facts.kind !== "user-preference-coauthor" ||
              typeof request.facts.profileId !== "string" ||
              request.facts.profileId.length === 0
            ) {
              throw new Error("Profile preference mutation returned invalid authority facts");
            }
            const facts: UserPreferenceCoauthorMutation = {
              kind: "user-preference-coauthor",
              profileId: request.facts.profileId,
            };
            pending = {
              facts,
              fence: fenceUserProfileMutationAuthority(context.admission, {
                profiles: [facts.profileId],
                identities: [],
                channels: [],
              }),
              granted: false,
            };
            pending.granted = grant();
          });
          publicationSettled = operation.settled.then((settlement) => {
            let committed = false;
            let receiptValid = false;
            try {
              const receipt = admission.committed;
              if (receipt) {
                if (!pending || !isDeepStrictEqual(receipt.facts, pending.facts)) {
                  throw new Error("Profile preference receipt changed its prepared mutation");
                }
                committed = true;
              }
              receiptValid = true;
            } finally {
              pending?.fence.settle(
                !pending.granted || committed || (receiptValid && settlement.kind === "completed"),
              );
            }
          });
          void publicationSettled.catch(() => undefined);
          return { admission, nativeLocations: [context.admission.databasePath] };
        },
      },
    );
  } finally {
    // Caller revocation cannot discard a committed preference change or its authority fence.
    try {
      await publicationSettled;
    } finally {
      finishMutation();
    }
  }
}
