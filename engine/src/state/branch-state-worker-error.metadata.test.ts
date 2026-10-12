import assert from "node:assert/strict";
import { expect, it } from "vitest";
import { findSourceImportBackedges } from "../../test/helpers/source-import-closure.js";
import {
  encodeBranchStateWorkerError,
  hydrateBranchStateWorkerError,
  retainBranchStateWorkerErrorPayload,
} from "./branch-state-worker-error.js";
import { SessionMetadataUnavailableError } from "./session-metadata-unavailable-error.js";

it("preserves canonical metadata unavailability and SQLite causes through cleanup", () => {
  const cause = Object.assign(new Error("synthetic SQLite read failure"), {
    code: "ERR_SQLITE_ERROR",
    errcode: 1,
  });
  const unavailable = new SessionMetadataUnavailableError("table-missing", { cause }, [
    "session_nodes",
  ]);
  const cleanup = new Error("synthetic database close failure");
  const payload = encodeBranchStateWorkerError(
    new AggregateError([unavailable, cleanup], "read and close failed", { cause: cleanup }),
  );
  expect(payload).toBeDefined();
  const carrier = new Error("remote error");
  retainBranchStateWorkerErrorPayload(carrier, structuredClone(payload));
  const decoded = hydrateBranchStateWorkerError(carrier);
  assert(decoded instanceof AggregateError);
  const restored = decoded.errors[0];
  expect(restored).toBeInstanceOf(SessionMetadataUnavailableError);
  expect(restored).toMatchObject({
    reason: "table-missing",
    missingTables: ["session_nodes"],
    cause: { message: cause.message, code: "ERR_SQLITE_ERROR", errcode: 1 },
  });
  expect(decoded.errors[1]).toBe(decoded.cause);
  expect(decoded.cause).toMatchObject({ message: cleanup.message });
});

it("keeps shared error transport independent of agent schema classification", () => {
  expect(
    findSourceImportBackedges("src/state/branch-state-worker-error.ts", [
      "src/state/branch-agent-db-read-error.ts",
      "src/state/branch-agent-schema.ts",
      "src/state/branch-agent-db-schema-compatibility.ts",
    ]),
  ).toEqual([]);
});
