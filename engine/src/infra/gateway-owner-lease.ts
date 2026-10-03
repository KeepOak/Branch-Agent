import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { DatabaseSync } from "node:sqlite";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getFileLockProcessStartTime } from "../shared/pid-alive.js";
import type { BranchStateSchemaReadAdmission } from "../state/branch-state-db-contract.js";
import {
  withExistingBranchStateDatabaseCurrentReadOnly,
  withExistingBranchStateDatabaseReadOnly,
} from "../state/branch-state-db-readonly.js";
import { withBranchStateStartupMigrationCheckpointDatabase } from "../state/branch-state-db.js";
import { resolveBranchStateSqlitePath } from "../state/branch-state-db.paths.js";
import { startBranchStateLeaseHeartbeat } from "../state/branch-state-lease-heartbeat.js";
import {
  acquireBranchStateLeaseInTransaction,
  reclaimDeadBranchStateLeaseInTransaction,
  releaseBranchStateLeaseInTransaction,
} from "../state/branch-state-lease-store.js";
import { assertBranchStateWriteAllowed } from "../state/branch-state-ownership.js";
import { gatewayOwnerKey, readGatewayOwnerLeaseFromDatabase } from "./gateway-owner-lease.read.js";
import type {
  GatewayOwnerLeaseIdentity,
  GatewayOwnerSupervisor,
} from "./gateway-owner-lease.types.js";
import { resolveDiagnosticProcessEnv } from "./process-env.js";
import { runSqliteImmediateTransactionSync } from "./sqlite-transaction.js";
import { STARTUP_MIGRATION_LEASE_TTL_MS } from "./startup-migration-checkpoint.js";

const log = createSubsystemLogger("gateway");

export type GatewayOwnerLease = {
  owner: string;
  ready: Promise<void>;
  release: () => Promise<void>;
};

export function readGatewayOwnerLease(
  params: {
    env?: NodeJS.ProcessEnv;
    port?: number;
    /** Mutation admission must not inherit a discovery snapshot. */
    current?: boolean;
    openStateSchemaReadAdmission?: BranchStateSchemaReadAdmission;
  } = {},
): GatewayOwnerLeaseIdentity | undefined {
  const operation = ({ db }: { db: DatabaseSync }) =>
    readGatewayOwnerLeaseFromDatabase(db, params.port);
  return params.current || params.openStateSchemaReadAdmission
    ? withExistingBranchStateDatabaseCurrentReadOnly(
        operation,
        { env: params.env },
        params.openStateSchemaReadAdmission,
      )
    : withExistingBranchStateDatabaseReadOnly(operation, { env: params.env });
}

/** Publish only while the caller holds the Gateway lifecycle coordinator. */
export function acquireGatewayOwnerLease(params: {
  env?: NodeJS.ProcessEnv;
  port: number;
  mode: GatewayOwnerLeaseIdentity["mode"];
  supervisor: GatewayOwnerSupervisor | null;
  owner?: string;
}): GatewayOwnerLease {
  const env = params.env ?? process.env;
  const databasePath = resolveBranchStateSqlitePath(env);
  const identity = { ...gatewayOwnerKey, owner: params.owner ?? randomUUID() };
  const processOwner = {
    pid: process.pid,
    host: hostname(),
    // Retry the native self lookup with its full Windows budget before publication.
    startedAt:
      getFileLockProcessStartTime(process.pid, env) ??
      getFileLockProcessStartTime(process.pid, env),
  };
  const payloadJson = JSON.stringify({
    owner: processOwner,
    port: params.port,
    mode: params.mode,
    supervisor: params.supervisor,
  });
  const expiresAt = withBranchStateStartupMigrationCheckpointDatabase(
    (db) =>
      runSqliteImmediateTransactionSync(
        db,
        () => {
          assertBranchStateWriteAllowed({ database: db, databasePath, env });
          reclaimDeadBranchStateLeaseInTransaction(db, identity);
          const acquired = acquireBranchStateLeaseInTransaction(
            db,
            identity,
            STARTUP_MIGRATION_LEASE_TTL_MS,
            payloadJson,
          );
          if (acquired.kind === "held") {
            throw new Error("Another Gateway owner lease is still active for this state directory");
          }
          return acquired.expiresAt;
        },
        {
          databaseLabel: databasePath,
          operationLabel: "gateway.owner-lease.acquire",
        },
      ),
    { env, path: databasePath },
  );
  const releaseRow = () =>
    withBranchStateStartupMigrationCheckpointDatabase(
      (db) =>
        runSqliteImmediateTransactionSync(
          db,
          () => {
            assertBranchStateWriteAllowed({ database: db, databasePath, env });
            releaseBranchStateLeaseInTransaction(db, identity);
          },
          {
            databaseLabel: databasePath,
            operationLabel: "gateway.owner-lease.release",
          },
        ),
      { env, path: databasePath },
    );
  let heartbeat: ReturnType<typeof startBranchStateLeaseHeartbeat> | undefined;
  let constructionFailure: { error: unknown } | undefined;
  let warned = false;
  const ready = (async () => {
    try {
      // Start outside the write transaction so the worker never retains its lifecycle gate.
      heartbeat = startBranchStateLeaseHeartbeat({
        path: databasePath,
        identity,
        leaseMs: STARTUP_MIGRATION_LEASE_TTL_MS,
        acquiredAt: expiresAt - STARTUP_MIGRATION_LEASE_TTL_MS,
        expiresAt,
        heartbeatMs: 30_000,
        ...(processOwner.startedAt === null
          ? { processOwner: { identity: processOwner, env: resolveDiagnosticProcessEnv(env) } }
          : {}),
        onLost: () => {
          if (!warned) {
            warned = true;
            log.warn("Gateway owner lease heartbeat stopped; process identity remains recorded");
          }
        },
      });
    } catch (error) {
      constructionFailure = { error };
      throw error;
    }
    await heartbeat.ready;
  })();
  let released = false;
  return {
    owner: identity.owner,
    ready,
    async release() {
      if (released) {
        return;
      }
      if (constructionFailure) {
        // Construction did not return cleanup custody; keep the physical owner held.
        throw new Error("Gateway owner heartbeat cleanup could not be confirmed", {
          cause: constructionFailure.error,
        });
      }
      await heartbeat?.stop();
      releaseRow();
      released = true;
    },
  };
}
