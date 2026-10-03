import { toStringifiedError } from "@branch/normalization-core/error-coercion";
import { isRecord } from "@branch/normalization-core/record-coerce";
import type { NativeErrorResponse } from "../../infra/native-error-response-schema.js";
import { serializeNativeErrorResponse } from "../../infra/native-error-response.js";
import { SqliteSchemaVersionError } from "../../infra/sqlite-user-version.js";
import { serveWorkerTasks } from "../../infra/worker-task-server.js";
import { BRANCH_SQLITE_BUSY_TIMEOUT_MS } from "../../state/branch-state-db-contract.js";
import type { NativeHookRelayBridgeRecord } from "./native-hook-relay-bridge-record.js";
import { readNativeHookRelayClientRecord } from "./native-hook-relay-client-read.js";

export type NativeHookRelayClientReadResult =
  | { ok: true; record: NativeHookRelayBridgeRecord | undefined }
  | { ok: false; error: NativeErrorResponse; newerSchema: boolean };

serveWorkerTasks((input): NativeHookRelayClientReadResult => {
  try {
    if (
      !isRecord(input) ||
      typeof input.relayId !== "string" ||
      typeof input.stateDbPath !== "string"
    ) {
      throw new Error("Native hook relay locator worker requires a relay id and database path");
    }
    return {
      ok: true,
      record: readNativeHookRelayClientRecord(
        { relayId: input.relayId, stateDbPath: input.stateDbPath },
        BRANCH_SQLITE_BUSY_TIMEOUT_MS,
      ),
    };
  } catch (value) {
    const error = toStringifiedError(value);
    return {
      ok: false,
      error: serializeNativeErrorResponse(error),
      newerSchema: error instanceof SqliteSchemaVersionError,
    };
  }
});
