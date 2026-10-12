import type { Result } from "@branch/normalization-core/result";
import { cloneEnvWithPlatformSemantics } from "../../../config/config-env-vars.js";
import { runtimeProcessEntrypoints } from "../../../infra/runtime-process-entrypoints.js";
import { resolveRuntimeWorkerUrl } from "../../../infra/runtime-worker-url.js";
import { throwSqliteLifecycleErrors } from "../../../infra/sqlite-lifecycle-errors.js";
import { readDatabasePathIdentitySync } from "../../../infra/sqlite-worker-identity.js";
import type { BranchAgentDatabaseOptions } from "../../../state/branch-agent-db-contract.js";
import { resolveBranchAgentSqlitePath } from "../../../state/branch-agent-db.paths.js";
import { captureBranchAgentDatabaseExecution } from "../../../state/branch-agent-execution.js";
import { openBranchAgentSqliteWorkerStore } from "../../../state/branch-agent-worker-store.js";
import { runBranchAgentWriteAdmission } from "../../../state/branch-agent-write-admission.js";
import {
  hydrateBranchStateWorkerError,
  retainBranchStateWorkerErrorPayload,
} from "../../../state/branch-state-worker-error.js";
import type { AcpParentStreamWorkerOperations } from "./acp-parent-stream-store.worker.js";

export type AcpParentStreamEvent = Record<string, unknown>;
type EventBatch = Array<{ event: AcpParentStreamEvent; createdAt: number }>;

/** Captures the child and physical store before delayed relay flushes can yield. */
export function createAcpParentStreamRecorder(
  input: BranchAgentDatabaseOptions & { sessionId: string; runId: string },
) {
  const options = { ...input, env: cloneEnvWithPlatformSemantics(input.env ?? process.env) };
  const identity = readDatabasePathIdentitySync(resolveBranchAgentSqlitePath(options));
  if (!identity.key.startsWith("file:")) {
    throw new Error("ACP parent-stream diagnostics require the existing child database");
  }
  const execution = captureBranchAgentDatabaseExecution(options, {
    expectedIdentity: {
      kind: "file",
      physicalIdentity: identity.key.slice("file:".length),
      nativeLocation: identity.canonicalPath,
      birthtime: identity.birthtime,
    },
  });
  options.path = execution.path;
  const worker = openBranchAgentSqliteWorkerStore<AcpParentStreamWorkerOperations>(
    options,
    { execution },
    {
      moduleUrl: resolveRuntimeWorkerUrl(runtimeProcessEntrypoints.acpParentStreamStore),
      input: undefined,
    },
  );
  // A relay may finish without any serializable diagnostics.
  void worker.catch(() => {});
  return {
    async record(events: EventBatch): Promise<Result<void, Error>> {
      const prepared = events.flatMap((entry) => {
        try {
          const eventJson = JSON.stringify(entry.event);
          if (eventJson !== undefined) {
            return [{ eventJson, createdAt: entry.createdAt }];
          }
        } catch {
          // One malformed diagnostic must not poison later valid events or retries.
        }
        return [];
      });
      if (prepared.length === 0) {
        return { ok: true, value: undefined };
      }
      const result = await runBranchAgentWriteAdmission(
        options,
        async () =>
          (await worker).execute(
            {
              type: "record",
              input: { sessionId: options.sessionId, runId: options.runId, events: prepared },
            },
            () => execution.assertCurrent(),
          ),
        true,
      );
      if (result.ok) {
        return result;
      }
      const error = new Error("ACP parent-stream transaction rolled back");
      retainBranchStateWorkerErrorPayload(error, result.error);
      return {
        ok: false,
        error: hydrateBranchStateWorkerError(error, { includeOrdinary: true }),
      };
    },
    async close(): Promise<void> {
      const failures: unknown[] = [];
      for (const close of [async () => (await worker).close(), () => execution.release()]) {
        try {
          await close();
        } catch (error) {
          failures.push(error);
        }
      }
      throwSqliteLifecycleErrors(failures, "ACP parent-stream recorder cleanup failed");
    },
  };
}
