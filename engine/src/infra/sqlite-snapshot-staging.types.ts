import type { MessagePort } from "node:worker_threads";
import type { RetainedOperation } from "@branch/worker-runtime/lifecycle";
import type { BranchStateWorkerErrorPayload } from "../state/branch-state-worker-error.js";
import type { DatabaseFileIdentity } from "./sqlite-worker-identity.js";

export type SqliteSnapshotStagingDirectory = {
  directory: string;
  startRetire: () => RetainedOperation<void>;
};

export type SqliteSnapshotStagingLaunch = {
  env: NodeJS.ProcessEnv;
  cwd: string;
  transport: { kind: "native" };
};

type SqliteSnapshotStagingAllocation = {
  root: string;
  allowLegacyWorker: boolean;
  launch: SqliteSnapshotStagingLaunch;
};

export type SqliteSnapshotStagingInput = SqliteSnapshotStagingAllocation &
  (
    | { type: "allocate" }
    | {
        type: "prepare";
        pathname: string;
        preserveSourceArtifacts: boolean;
        expectedSourceIdentity?: DatabaseFileIdentity;
        deadlineOwnedByCaller: boolean;
        abortPort?: MessagePort;
      }
  );

export type SqliteSnapshotStagingReply =
  | { type: "allocated"; directory: string }
  | { type: "prepared"; directory: string; location: string }
  | {
      type: "failed";
      error: BranchStateWorkerErrorPayload;
      cleanupFailure?: true;
      directory?: string;
    };

export type SqliteSnapshotStagingCommand = SqliteSnapshotStagingInput & {
  preparationId: number;
};

export type SqliteSnapshotStagingRequest = RetainedOperation<
  Exclude<SqliteSnapshotStagingReply, { type: "failed" }>
> & {
  startClose(): RetainedOperation<void>;
};
