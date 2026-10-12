import type { WorktreeTemplateWorkerOperations } from "../agents/worktrees/template-registry.worker.js";
import {
  loadDeviceIdentityIfPresent,
  loadOrCreateDeviceIdentity,
} from "../infra/device-identity.js";
import { assertNoActiveSqliteReaders } from "../infra/sqlite-reader-lifecycle.js";
import { assertTransactionUsable } from "../infra/sqlite-transaction.js";
import { SQLITE_WORKER_PREPARE_COMMAND } from "../infra/sqlite-worker-contract.js";
import { assertExistingDatabaseIdentity } from "../infra/sqlite-worker-identity.js";
import { requestSqliteWorkerOperationAdmission } from "../infra/sqlite-worker-operation-admission.js";
import {
  getSqliteWorkerStateContext,
  withSqliteWorkerExistingDatabase,
} from "../infra/sqlite-worker-state-context.js";
import {
  isPluginStateWorkerCommand,
  pluginStateWorkerOperations,
} from "../plugin-state/plugin-state-worker-contract.js";
import { readPluginMetadataStateRowSync } from "../plugins/installed-plugin-index-row.js";
import {
  branchStateDatabaseCache,
  retainBranchStateDatabase,
} from "./branch-state-db-cache.js";
import type { BranchStateDatabase } from "./branch-state-db-contract.js";
import type { ExistingBranchStateWriter } from "./branch-state-db-existing-write.js";
import { assertBranchStateDatabaseOwner } from "./branch-state-db-maintenance.js";
import { ensureSecretStoreSchema } from "./branch-state-db-schema-additive.js";
import {
  openBranchStateDatabase,
  runBranchStateWriteTransaction,
} from "./branch-state-db.js";
import {
  acquireBranchStateLeaseInWorker,
  executeBranchStateLeaseCommand,
} from "./branch-state-lease-worker.js";
import type {
  BranchStateWorkerBackend,
  BranchStateWorkerOpenPreparation,
  BranchStateWorkerOperations,
} from "./branch-state-worker-contract.js";
import { createWorkerOperationRegistry } from "./worker-operation-registry.js";

// PR provisioning retains allocation and template owners without the application runtime.
const provisionRegistry = createWorkerOperationRegistry<
  WorktreeTemplateWorkerOperations &
    Pick<BranchStateWorkerOperations, "worktrees.reserveCapacity">
>({
  worktrees: async () => {
    const [templates, reserveCapacity] = await Promise.all([
      import("../agents/worktrees/template-registry.worker.js").then(
        (loaded) => loaded.worktreeTemplateOperations,
      ),
      import("../agents/worktrees/capacity.worker.js").then(
        (loaded) => loaded.reserveWorktreeCapacityInWorker,
      ),
    ]);
    return {
      ...templates,
      "worktrees.reserveCapacity": reserveCapacity,
    };
  },
});

let agentCleanup: typeof import("./branch-agent-execution-cleanup.worker.js") | undefined;
let pluginState: typeof import("../plugin-state/plugin-state.worker.js") | undefined;
let capture: typeof import("../proxy-capture/store.worker.js") | undefined;
let runtime: typeof import("./branch-state-worker-runtime.js") | undefined;

function stateDatabaseInitializationEnvironment(): NodeJS.ProcessEnv {
  const context = getSqliteWorkerStateContext();
  return context.initializationEnvironment ?? context.environment;
}

export function createSqliteWorkerBackend(
  _input: undefined,
  context: { databasePath: string; preparation?: BranchStateWorkerOpenPreparation },
): BranchStateWorkerBackend {
  if (context.preparation?.type === "deviceIdentity") {
    loadOrCreateDeviceIdentity({
      path: context.databasePath,
      env: stateDatabaseInitializationEnvironment(),
      identityKey: context.preparation.identityKey,
    });
  }
  const database = openBranchStateDatabase({
    path: context.databasePath,
    env: stateDatabaseInitializationEnvironment(),
    initializationAgentPaths: getSqliteWorkerStateContext().initializationAgentPaths,
  });
  return createSharedStateWorkerBackend(context, database);
}

export function openExistingSqliteWorkerBackend(
  _input: undefined,
  context: { databasePath: string; existingIdentity: string },
): BranchStateWorkerBackend {
  const identity = context.existingIdentity;
  assertExistingDatabaseIdentity(context.databasePath, identity);
  const backend = createSharedStateWorkerBackend(context, undefined, identity);
  return {
    ...backend,
    execute(command) {
      return withSqliteWorkerExistingDatabase(context.databasePath, identity, () =>
        backend.execute(command),
      );
    },
  };
}

function createSharedStateWorkerBackend(
  context: { databasePath: string },
  initialDatabase?: BranchStateDatabase,
  existingIdentity?: string,
): BranchStateWorkerBackend {
  let nativeDatabase = initialDatabase;
  let updateRunWriter: ExistingBranchStateWriter | undefined;
  let borrow = nativeDatabase ? retainBranchStateDatabase(nativeDatabase) : undefined;
  let closed = false;
  let secretSchemaAdmitted = false;
  const open = (): BranchStateDatabase => {
    if (!nativeDatabase) {
      const opened = openBranchStateDatabase({
        path: context.databasePath,
        env: stateDatabaseInitializationEnvironment(),
        initializationAgentPaths: getSqliteWorkerStateContext().initializationAgentPaths,
      });
      borrow = retainBranchStateDatabase(opened);
      nativeDatabase = opened;
    }
    if (
      !nativeDatabase.db.isOpen ||
      branchStateDatabaseCache.getCachedBranchStateDatabase(nativeDatabase.path) !==
        nativeDatabase
    ) {
      throw new Error("Shared-state worker lost its retained native database");
    }
    return openBranchStateDatabase({
      database: nativeDatabase,
      path: context.databasePath,
      env: getSqliteWorkerStateContext().environment,
    });
  };
  return {
    [SQLITE_WORKER_PREPARE_COMMAND](commandType) {
      if (
        commandType.startsWith("worktrees.templates.") ||
        commandType === "worktrees.reserveCapacity"
      ) {
        return provisionRegistry.prepare(commandType);
      }
      if (commandType.startsWith("capture.")) {
        if (capture) {
          return undefined;
        }
        return import("../proxy-capture/store.worker.js").then((loaded) => {
          capture = loaded;
        });
      }
      if (commandType === "agentDatabases.releaseExitedLease") {
        if (agentCleanup) {
          return undefined;
        }
        return import("./branch-agent-execution-cleanup.worker.js").then((loaded) => {
          agentCleanup = loaded;
        });
      }
      if (Object.hasOwn(pluginStateWorkerOperations, commandType)) {
        if (pluginState) {
          return undefined;
        }
        return import("../plugin-state/plugin-state.worker.js").then((loaded) => {
          pluginState = loaded;
        });
      }
      if (
        commandType === "plugins.metadata.read" ||
        commandType === "database.inspectIdle" ||
        commandType === "database.walMaintenance" ||
        commandType === "stateLease.acquire" ||
        commandType === "deviceIdentity.read" ||
        commandType === "deviceIdentity.load" ||
        commandType === "stateLease.verify" ||
        commandType === "stateLease.renew" ||
        commandType === "stateLease.release"
      ) {
        return undefined;
      }
      if (runtime) {
        return runtime.prepareSharedStateCommand(commandType);
      }
      return import("./branch-state-worker-runtime.js").then((loaded) => {
        runtime = loaded;
        return runtime.prepareSharedStateCommand(commandType);
      });
    },
    execute(command) {
      if (closed) {
        throw new Error("Shared-state worker is closed");
      }
      if (provisionRegistry.has(command)) {
        return provisionRegistry.execute(command, {
          open,
          stateOptions: () => ({
            path: context.databasePath,
            env: getSqliteWorkerStateContext().environment,
          }),
        });
      }
      if (
        command.type === "capture.upsertSession" ||
        command.type === "capture.endSession" ||
        command.type === "capture.persistPayload" ||
        command.type === "capture.recordEvent" ||
        command.type === "capture.recordEventWithPayload" ||
        command.type === "capture.listSessions" ||
        command.type === "capture.getSessionEvents" ||
        command.type === "capture.summarizeSessionCoverage" ||
        command.type === "capture.readBlob" ||
        command.type === "capture.queryPreset" ||
        command.type === "capture.deleteSessions" ||
        command.type === "capture.purgeAll"
      ) {
        if (!capture) {
          throw new Error("Capture worker command runtime is not prepared");
        }
        return capture.executeCaptureCommand(command, open());
      }
      if (command.type === "deviceIdentity.read") {
        return loadDeviceIdentityIfPresent({
          path: context.databasePath,
          identityKey: command.input.identityKey,
          env: getSqliteWorkerStateContext().environment,
        });
      }
      if (command.type === "deviceIdentity.load") {
        try {
          return loadOrCreateDeviceIdentity({
            path: context.databasePath,
            identityKey: command.input.identityKey,
            env: stateDatabaseInitializationEnvironment(),
          });
        } finally {
          // An existing-only actor may acquire its first writable handle through this owner.
          const database = branchStateDatabaseCache.getCachedBranchStateDatabase(
            context.databasePath,
          );
          if (!nativeDatabase && database) {
            borrow = retainBranchStateDatabase(database);
            nativeDatabase = database;
          }
        }
      }
      if (command.type === "agentDatabases.releaseExitedLease") {
        if (!agentCleanup) {
          throw new Error("Agent database cleanup runtime is not prepared");
        }
        return agentCleanup.executeAgentDatabaseCleanupCommand(
          command,
          open(),
          getSqliteWorkerStateContext().environment,
        );
      }
      if (command.type === "stateLease.acquire") {
        if (command.input.schemaPolicy === "existing" && existingIdentity) {
          // Existing-schema leases open a separate native connection outside open().
          assertExistingDatabaseIdentity(context.databasePath, existingIdentity);
        }
        return acquireBranchStateLeaseInWorker(command.input, context.databasePath, open);
      }
      if (
        command.type === "stateLease.verify" ||
        command.type === "stateLease.renew" ||
        command.type === "stateLease.release"
      ) {
        return executeBranchStateLeaseCommand(command, open());
      }
      if (command.type === "plugins.metadata.read") {
        return readPluginMetadataStateRowSync(
          command.input.selector,
          { path: context.databasePath, env: getSqliteWorkerStateContext().environment },
          command.input.artifactPreservingReadOnly,
        );
      }
      if (command.type === "database.walMaintenance") {
        return (
          open().walMaintenance.maintainPeriodic?.(command.input, (stage) => {
            requestSqliteWorkerOperationAdmission({ stage, facts: undefined });
          }) ?? { reclaimedPages: 0 }
        );
      }
      if (command.type === "database.inspectIdle") {
        // Idle maintenance must never materialize a connection for an artifact-preserving reader.
        if (
          !nativeDatabase?.db.isOpen ||
          branchStateDatabaseCache.getCachedBranchStateDatabase(nativeDatabase.path) !==
            nativeDatabase
        ) {
          if (!nativeDatabase && updateRunWriter) {
            updateRunWriter.assertSettled();
            return "healthy";
          }
          return "retire";
        }
        assertBranchStateDatabaseOwner(nativeDatabase.db, { pathname: nativeDatabase.path });
        return nativeDatabase.walMaintenance.inspectIdle?.() ?? "retire";
      }
      if (isPluginStateWorkerCommand(command)) {
        if (!pluginState) {
          throw new Error("Plugin-state worker command runtime is not prepared");
        }
        return pluginState.executePluginStateCommand(
          command,
          {
            path: context.databasePath,
            env: getSqliteWorkerStateContext().environment,
          },
          open,
          nativeDatabase?.db.isOpen === true,
        );
      }
      const currentRuntime = runtime;
      if (!currentRuntime) {
        throw new Error("Shared-state worker command runtime is not prepared");
      }
      if (command.type === "secrets.write" && !secretSchemaAdmitted) {
        runBranchStateWriteTransaction(
          ({ db }) => ensureSecretStoreSchema(db),
          { database: open() },
          {
            operationLabel: "secrets.store.admit",
          },
        );
        secretSchemaAdmitted = true;
      }
      return currentRuntime.executeSharedStateCommand(
        command,
        context,
        open,
        () =>
          (updateRunWriter ??= currentRuntime.openUpdateRunWriter({
            path: context.databasePath,
            env: getSqliteWorkerStateContext().environment,
          })),
      );
    },
    assertSettled() {
      updateRunWriter?.assertSettled();
      if (nativeDatabase) {
        assertTransactionUsable(nativeDatabase.db);
        if (nativeDatabase.db.isOpen && nativeDatabase.db.isTransaction) {
          throw new Error("Shared-state worker retained an unsettled transaction");
        }
        if (nativeDatabase.db.isOpen) {
          assertNoActiveSqliteReaders(nativeDatabase.db, "Shared-state worker");
        }
      }
    },
    async close() {
      closed = true;
      try {
        updateRunWriter?.close();
      } finally {
        await borrow?.releaseAsync();
      }
    },
  };
}
