import { constants, setPriority } from "node:os";
import { isRecord } from "@branch/normalization-core/record-coerce";
import { formatSqliteErrorCodeSuffix } from "../infra/sqlite-error-diagnostics.js";
import { serializeSqliteFileGeneration } from "../infra/sqlite-file-generation.js";
import { BRANCH_SQLITE_BUSY_TIMEOUT_MS } from "./branch-state-db-contract.js";

const DATABASE_VERIFY_CHILD_ARG = "--branch-database-verify-child";

export type BranchDatabaseVerifyTarget = {
  path: string;
  kind: "agent" | "state";
  label: string;
  check: "quick" | "full";
  confirm?: true;
};

export type BranchDatabaseVerifyResult = {
  path: string;
  ok: boolean;
  error?: string;
  terminal?: boolean;
  generation?: string;
};

function isVerifyTarget(target: unknown): target is BranchDatabaseVerifyTarget {
  return (
    isRecord(target) &&
    typeof target.path === "string" &&
    (target.kind === "agent" || target.kind === "state") &&
    typeof target.label === "string" &&
    (target.check === "quick" || target.check === "full") &&
    (target.confirm === undefined || (target.confirm === true && target.check === "full"))
  );
}

function formatVerifyError(error: unknown): string {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return `${message}${formatSqliteErrorCodeSuffix(error)}`;
}

async function verifyBranchDatabase(
  target: BranchDatabaseVerifyTarget,
): Promise<BranchDatabaseVerifyResult> {
  const [integrity, source] = await Promise.all([
    import("../infra/sqlite-integrity.js"),
    import("../infra/sqlite-source-handle.js"),
  ]);
  if (target.confirm) {
    const confirmation = integrity.confirmSqliteFileIntegrity(target.path, target.label);
    if (confirmation.status === "healthy") {
      return {
        path: target.path,
        ok: true,
        generation: serializeSqliteFileGeneration(confirmation.generation),
      };
    }
    return {
      path: target.path,
      ok: false,
      error: formatVerifyError(confirmation.error),
      terminal: confirmation.terminal,
      ...(confirmation.terminal
        ? { generation: serializeSqliteFileGeneration(confirmation.generation) }
        : {}),
    };
  }
  const failed = (error: unknown): BranchDatabaseVerifyResult => ({
    path: target.path,
    ok: false,
    error: formatVerifyError(error),
    terminal: error instanceof Error && integrity.isTerminalSqliteIntegrityError(error),
  });
  let result: BranchDatabaseVerifyResult = { path: target.path, ok: true };
  try {
    source.withSqliteSourceReadDatabase(target.path, "source", (reader) => {
      try {
        reader.exec(`PRAGMA busy_timeout = ${BRANCH_SQLITE_BUSY_TIMEOUT_MS}; BEGIN;`);
        integrity.assertSqliteIntegrity(
          reader,
          target.label,
          target.check === "full" ? "integrity_check" : "quick_check",
        );
        reader.exec("ROLLBACK;");
      } catch (error) {
        // Preserve the check's classification if the source reader also fails to close.
        result = failed(error);
      }
    });
  } catch (error) {
    if (result.ok) {
      result = failed(error);
    }
  }
  return result;
}

/** Verify database files serially so large agent scans never compete for I/O. */
export async function verifyBranchDatabases(
  targets: readonly BranchDatabaseVerifyTarget[],
): Promise<BranchDatabaseVerifyResult[]> {
  const results: BranchDatabaseVerifyResult[] = [];
  for (const target of targets) {
    results.push(await verifyBranchDatabase(target));
  }
  return results;
}

// This module is also imported for its verifier function. Only the dedicated
// child may consume and disconnect the process-wide IPC channel.
const sendToParent =
  process.argv[2] === DATABASE_VERIFY_CHILD_ARG ? process.send?.bind(process) : undefined;
if (sendToParent) {
  process.once("message", (message: unknown) => {
    void (async () => {
      try {
        const targets = Array.isArray(message) ? message.filter(isVerifyTarget) : [];
        if (targets.some((target) => target.check === "full")) {
          try {
            setPriority(process.pid, constants.priority.PRIORITY_LOW);
          } catch {
            // Priority is best effort; only this dedicated child changes it.
          }
        }
        const results = await verifyBranchDatabases(targets);
        await new Promise<void>((resolve, reject) => {
          sendToParent(results, (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      } catch {
        process.exitCode = 1;
      } finally {
        process.disconnect?.();
      }
    })();
  });
}
