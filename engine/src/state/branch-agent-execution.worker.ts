import { MessageChannel, receiveMessageOnPort } from "node:worker_threads";
import { expectDefined } from "@branch/normalization-core";
import { isRecord } from "@branch/normalization-core/record-coerce";
import type { Result } from "@branch/normalization-core/result";
import { createSqliteLifecycleAggregateError } from "../infra/sqlite-lifecycle-errors.js";
import { assertTransactionUsable } from "../infra/sqlite-transaction.js";
import {
  SQLITE_WORKER_CLOSE_RECEIPT,
  SQLITE_WORKER_OPERATION_CLEANUP,
  SQLITE_WORKER_PREPARE_ADMITTED,
  type SqliteWorkerCloseReceipt,
  type SqliteWorkerCommand,
  type SqliteWorkerPreparedBackend,
} from "../infra/sqlite-worker-contract.js";
import {
  assertExistingDatabaseIdentity,
  normalizeDatabasePath,
  readDatabasePathIdentitySync,
} from "../infra/sqlite-worker-identity.js";
import {
  requestSqliteWorkerOperationAdmission,
  takeSqliteWorkerOperationAdmissionAttachment,
  SqliteWorkerOpenRefusedError,
  type SqliteWorkerAdmissionRequest,
} from "../infra/sqlite-worker-operation-admission.js";
import { readAgentDeletionJournalStatusInDatabase } from "./agent-deletion-journal.read.js";
import type {
  BranchAgentDatabase,
  BranchAgentDatabaseRegistrationCommit,
} from "./branch-agent-db-contract.js";
import { readBranchAgentDatabaseIdentity } from "./branch-agent-db-identity.js";
import { prepareBranchAgentDatabaseWorkerLease } from "./branch-agent-db-lease.js";
import { retainAgentDatabase } from "./branch-agent-db-lifecycle.js";
import { ensureBranchAgentDatabasePermissions } from "./branch-agent-db-permissions.js";
import {
  getBranchAgentDatabaseValidation,
  type BranchAgentDatabaseValidation,
} from "./branch-agent-db-validation-cache.js";
import {
  getBranchAgentDatabaseIfOpen,
  openBranchAgentDatabase,
  runBranchAgentWriteTransaction,
} from "./branch-agent-db.js";
import { closeAgentDatabaseExecution } from "./branch-agent-execution-close.js";
import type {
  AgentDatabaseExecutionIdentity,
  AgentDatabaseExecutionOpen,
  AgentDatabaseOperations,
} from "./branch-agent-execution-contract.js";
import {
  createAgentDatabaseDomainOwner,
  requestRestrictedAgentDatabaseAdmission,
  type AgentDatabaseAdmissionRestriction,
} from "./branch-agent-execution-domain.js";
import {
  loadAgentTranscriptOperations,
  loadAgentReplacementOperations,
  loadAgentEntryReadOperations,
  loadAgentTrajectoryOperations,
  loadAgentArchiveOperations,
  loadAgentAcpOperations,
  loadAgentProviderReviewOperations,
  loadAgentReactionOperations,
  loadAgentPendingInputOperations,
  loadAgentArchivePruningOperations,
  prepareAgentTranscript,
  type RegisteredAgentWorkerOperations,
} from "./branch-agent-execution-operations.js";
import type { AgentWorkerOperationContext } from "./branch-agent-operation-context.js";
import {
  requireBranchStateDatabaseIdentity,
  retainBranchStateDatabase,
} from "./branch-state-db-cache.js";
import { openBranchStateDatabase } from "./branch-state-db.js";
import { createWorkerOperationRegistry } from "./worker-operation-registry.js";

export function createSqliteWorkerBackend(
  input: AgentDatabaseExecutionOpen,
  opening: { databasePath: string },
): SqliteWorkerPreparedBackend<AgentDatabaseOperations> {
  const backend = openAgentDatabaseBackend(input, opening);
  try {
    backend.execute({ type: "database.prepareWrite", input: undefined });
    backend.assertSettled?.();
    return backend;
  } catch (error) {
    try {
      backend.close();
    } catch (cleanupError) {
      throw createSqliteLifecycleAggregateError(
        [error, cleanupError],
        "Agent creation and cleanup failed",
        error,
      );
    }
    throw error;
  }
}

/** The broker supplies a private admission channel before invoking this native factory. */
export const openExistingSqliteWorkerBackend: (
  input: AgentDatabaseExecutionOpen,
  opening: { databasePath: string; existingIdentity?: string },
) => SqliteWorkerPreparedBackend<AgentDatabaseOperations> = openAgentDatabaseBackend;

function openAgentDatabaseBackend(
  input: AgentDatabaseExecutionOpen,
  opening: { databasePath: string; existingIdentity?: string },
): Omit<SqliteWorkerPreparedBackend<AgentDatabaseOperations>, "close"> & { close(): void } {
  if (opening.databasePath !== input.databasePath) {
    throw new Error("Agent database open does not match its captured execution owner");
  }
  const admitOpen = () => {
    try {
      requestSqliteWorkerOperationAdmission({ stage: "open", facts: input });
    } catch (error) {
      throw new SqliteWorkerOpenRefusedError(error);
    }
  };
  admitOpen();
  const options = { agentId: input.agentId, path: input.databasePath, env: input.environment };
  let admittedFileIdentity =
    input.creatingIdentity?.key ??
    opening.existingIdentity ??
    readDatabasePathIdentitySync(input.databasePath).key;
  let admittedFileBirthtime = input.creatingIdentity?.birthtime;
  const assertFileIdentity = () => {
    if (input.expectedIdentity) {
      assertExistingDatabaseIdentity(
        input.databasePath,
        `file:${input.expectedIdentity.physicalIdentity}`,
        input.expectedIdentity.birthtime,
      );
    }
    if (admittedFileIdentity.startsWith("path:")) {
      const current = readDatabasePathIdentitySync(input.databasePath);
      if (
        current.key !== admittedFileIdentity ||
        (input.creatingIdentity && current.canonicalPath !== input.creatingIdentity.canonicalPath)
      ) {
        throw new Error("Agent database target changed before creating open");
      }
    } else {
      if (
        input.creatingIdentity &&
        readDatabasePathIdentitySync(input.databasePath).canonicalPath !==
          input.creatingIdentity.canonicalPath
      ) {
        throw new Error("Agent database target changed before creating open");
      }
      assertExistingDatabaseIdentity(
        input.databasePath,
        admittedFileIdentity,
        admittedFileBirthtime,
      );
    }
  };
  let database: BranchAgentDatabase | undefined;
  let shared: ReturnType<typeof openBranchStateDatabase> | undefined;
  let sharedBorrow: ReturnType<typeof retainBranchStateDatabase> | undefined;
  let releaseBorrow: (() => void) | undefined;
  let identity: AgentDatabaseExecutionIdentity | undefined;
  let openingFailure: { error: unknown } | undefined;
  let startupJournalRequested = false;
  let publicationStartupJournal: boolean | undefined;
  const readRequestPreparation = () => {
    const attachment = takeSqliteWorkerOperationAdmissionAttachment();
    if (
      !isRecord(attachment) ||
      attachment.kind !== "agent-execution" ||
      typeof attachment.startupJournal !== "boolean"
    ) {
      throw new Error("Agent execution requires its request-local preparation facts");
    }
    return attachment.startupJournal;
  };
  // This request-local flag is installed only for the synchronous native command below.
  const readDeletionJournal = () =>
    readAgentDeletionJournalStatusInDatabase(
      expectDefined(shared, "Agent execution shared-state owner").db,
      input.agentId,
    ) !== "absent";
  const openWriter = () => {
    let validation: BranchAgentDatabaseValidation | undefined;
    if (!database) {
      // Promotion needs the current command's source authority before any durable open work.
      admitOpen();
      assertFileIdentity();
      if (!shared) {
        shared = openBranchStateDatabase({
          path: input.stateDatabasePath,
          env: input.environment,
          initializationAgentPaths: [input.databasePath],
        });
        sharedBorrow = retainBranchStateDatabase(shared);
      }
      const lease = prepareBranchAgentDatabaseWorkerLease(options, shared, input.leaseId);
      const { port1, port2 } = new MessageChannel();
      try {
        requestSqliteWorkerOperationAdmission(
          {
            stage: "prepare",
            facts: {
              kind: "shared-owner",
              identity: requireBranchStateDatabaseIdentity(shared),
              lease: lease.receipt,
              validationPort: port2,
            },
          },
          [port2],
        );
        // The host posts before granting admission; shared revocation remains live after transfer.
        // SAFETY: this private port receives only the host's typed validation receipt.
        lease.validation = receiveMessageOnPort(port1)?.message as
          | BranchAgentDatabaseValidation
          | undefined;
      } catch (error) {
        throw new SqliteWorkerOpenRefusedError(error);
      } finally {
        port1.close();
        port2.close();
      }
      assertFileIdentity();
      let registration: BranchAgentDatabaseRegistrationCommit | undefined;
      let openingResult: Result<BranchAgentDatabase, unknown>;
      try {
        const opened = openBranchAgentDatabase(options, lease, {
          starting: () =>
            requestSqliteWorkerOperationAdmission({
              stage: "prepare",
              facts: { kind: "agent-registration-start", lease: lease.receipt },
            }),
          committed(receipt) {
            registration = receipt;
          },
        });
        database = opened;
        releaseBorrow = retainAgentDatabase(opened.db);
        openingResult = { ok: true, value: opened };
      } catch (error) {
        // The opener can retain a failed native handle before returning one to this actor.
        openingFailure = { error };
        openingResult = { ok: false, error };
      }
      if (registration) {
        try {
          requestSqliteWorkerOperationAdmission({
            stage: "prepare",
            facts: { kind: "agent-registration-committed", registration },
          });
        } catch (error) {
          if (!openingResult.ok) {
            throw createSqliteLifecycleAggregateError(
              [openingResult.error, error],
              `${String(openingResult.error)}; committed registration reporting failed: ${String(error)}`,
              openingResult.error,
            );
          }
          throw error;
        }
      }
      if (!openingResult.ok) {
        throw openingResult.error;
      }
      const opened = openingResult.value;
      const nativeIdentity = readBranchAgentDatabaseIdentity(opened);
      if (typeof nativeIdentity.identity !== "string") {
        throw new Error("Disk agent execution requires its canonical file identity");
      }
      const openedFileIdentity = `file:${nativeIdentity.identity}`;
      if (
        admittedFileIdentity.startsWith("file:") &&
        (openedFileIdentity !== admittedFileIdentity ||
          (admittedFileBirthtime !== undefined &&
            nativeIdentity.birthtime !== admittedFileBirthtime))
      ) {
        throw new Error("Agent writer differs from its admitted physical file");
      }
      if (
        input.expectedIdentity &&
        nativeIdentity.identity !== input.expectedIdentity.physicalIdentity
      ) {
        throw new Error("Agent writer differs from its expected physical file");
      }
      admittedFileIdentity = openedFileIdentity;
      admittedFileBirthtime = nativeIdentity.birthtime;
      identity = {
        kind: "file",
        physicalIdentity: nativeIdentity.identity,
        birthtime: nativeIdentity.birthtime,
        incarnation: nativeIdentity.incarnation,
        nativeLocation: nativeIdentity.filename,
      };
      validation = getBranchAgentDatabaseValidation(opened);
    }
    if (!database || !database.db.isOpen || getBranchAgentDatabaseIfOpen(options) !== database) {
      throw new Error("Agent execution lost its retained native database");
    }
    requestSqliteWorkerOperationAdmission({
      stage: "prepare",
      facts: {
        identity,
        validation,
        ...(startupJournalRequested ? { agentDeletionJournalPresent: readDeletionJournal() } : {}),
      },
    });
    return database;
  };
  const admit = (
    stage: "transaction" | "commit",
    publication?: unknown,
    requestAdmission?: AgentDatabaseAdmissionRestriction,
  ) => {
    assertFileIdentity();
    const request: SqliteWorkerAdmissionRequest = {
      stage,
      facts: {
        identity,
        ...(startupJournalRequested ? { agentDeletionJournalPresent: readDeletionJournal() } : {}),
        ...(publication ? { publication } : {}),
      },
    };
    requestRestrictedAgentDatabaseAdmission(request, requestAdmission);
    if (stage === "commit") {
      ensureBranchAgentDatabasePermissions(input.databasePath, options);
    }
  };
  const writeTransaction = <T>(
    operationLabel: string,
    owner: string,
    write: (current: BranchAgentDatabase) => T,
  ): T => {
    const opened = openWriter();
    return runBranchAgentWriteTransaction(
      (current) => {
        if (current.db !== opened.db) {
          throw new Error(`${owner} lost its canonical database owner`);
        }
        admit("transaction");
        return write(current);
      },
      options,
      { operationLabel },
    );
  };
  const registry = createWorkerOperationRegistry<
    RegisteredAgentWorkerOperations,
    AgentWorkerOperationContext,
    keyof RegisteredAgentWorkerOperations
  >({
    "session.entry.read": loadAgentEntryReadOperations,
    "trajectory.events.append": loadAgentTrajectoryOperations,
    "session.archives.preparePublication": loadAgentArchiveOperations,
    "session.archives.recordPublication": loadAgentArchiveOperations,
    "session.transcript.initialize": loadAgentTranscriptOperations,
    "session.entries.replace": loadAgentReplacementOperations,
    "session.entry.acp": loadAgentAcpOperations,
    "session.providerReview.compare": loadAgentProviderReviewOperations,
    "session.reaction.set": loadAgentReactionOperations,
    "session.pendingInputs.withdraw": loadAgentPendingInputOperations,
    "session.archivePruning.deletePublished": loadAgentArchivePruningOperations,
    "session.archivePruning.removeLegacy": loadAgentArchivePruningOperations,
    "session.archivePruning.reclaimPages": loadAgentArchivePruningOperations,
  });
  const context: AgentWorkerOperationContext = {
    open: openWriter,
    options,
    admit,
    writeTransaction,
  };
  const domain = createAgentDatabaseDomainOwner({
    databasePath: input.databasePath,
    assertCurrent() {
      assertOpen();
      const current = openWriter();
      assertFileIdentity();
      return current.db;
    },
    assertCleanupCurrent() {
      if (
        !database ||
        !identity ||
        !database.db.isOpen ||
        normalizeDatabasePath(database.db.location() ?? "") !== identity.nativeLocation ||
        getBranchAgentDatabaseIfOpen(options) !== database
      ) {
        throw new Error("Agent cleanup lost its retained native database");
      }
      assertFileIdentity();
    },
    admit: (stage, requestAdmission) => admit(stage, undefined, requestAdmission),
  });
  let closed = false;
  let closeReceipt: SqliteWorkerCloseReceipt | undefined;
  const assertOpen = () => {
    if (closed) {
      throw new Error("Agent database execution owner is closed");
    }
  };
  const executeCommand = (command: SqliteWorkerCommand<AgentDatabaseOperations>) => {
    if (
      command.type === "database.domain.bind" ||
      command.type === "database.domain.publish" ||
      command.type === "database.domain.execute" ||
      command.type === "database.domain.close"
    ) {
      return domain.execute(command);
    }
    if (command.type === "database.prepareWrite") {
      openWriter();
      return undefined;
    }
    if (command.type === "database.walMaintenance") {
      return (
        openWriter().walMaintenance.maintainPeriodic?.(command.input, admit) ?? {
          reclaimedPages: 0,
        }
      );
    }
    return registry.execute(command, context);
  };
  return {
    prepare(command) {
      if (
        command.type === "database.domain.bind" ||
        command.type === "database.domain.publish" ||
        command.type === "database.domain.execute" ||
        command.type === "database.domain.close"
      ) {
        return domain.prepare(command);
      }
      const preparing = registry.prepare(command.type);
      if (command.type === "session.entries.replace" && command.input.initializeTranscript) {
        return Promise.all([preparing, prepareAgentTranscript()]).then(() => {});
      }
      return preparing;
    },
    [SQLITE_WORKER_PREPARE_ADMITTED](command) {
      if (command.type !== "database.domain.publish") {
        return undefined;
      }
      publicationStartupJournal = readRequestPreparation();
      startupJournalRequested = publicationStartupJournal;
      try {
        return domain.preparePublication(command.input);
      } finally {
        startupJournalRequested = false;
      }
    },
    [SQLITE_WORKER_OPERATION_CLEANUP](command) {
      if (command.type === "database.domain.publish") {
        startupJournalRequested = publicationStartupJournal ?? false;
        try {
          domain.cleanupPublication(command.input.id);
        } finally {
          startupJournalRequested = false;
          publicationStartupJournal = undefined;
        }
      }
    },
    assertSettled() {
      if (openingFailure) {
        // A failed promotion requires native retirement, including custody retained by the opener.
        throw openingFailure.error;
      }
      domain.assertSettled();
      if (database) {
        assertTransactionUsable(database.db);
        if (!identity || !database.db.isOpen || database.db.isTransaction) {
          throw new Error("Agent database command left an unsettled native connection");
        }
      }
    },
    execute(command) {
      assertOpen();
      if (command.type === "database.domain.publish") {
        if (publicationStartupJournal === undefined) {
          throw new Error("Agent publication lost its request-local preparation facts");
        }
        startupJournalRequested = publicationStartupJournal;
      } else {
        startupJournalRequested = readRequestPreparation();
      }
      try {
        return executeCommand(command);
      } finally {
        startupJournalRequested = false;
      }
    },
    [SQLITE_WORKER_CLOSE_RECEIPT]() {
      return closeReceipt;
    },
    close() {
      closed = true;
      closeReceipt = undefined;
      closeReceipt = closeAgentDatabaseExecution({
        database,
        identity,
        closeDomain: () => domain.close(),
        releaseBorrow,
        releaseSharedBorrow: () => sharedBorrow?.release(),
      });
    },
  };
}
