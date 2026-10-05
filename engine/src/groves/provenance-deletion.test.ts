import path from "node:path";
import { describe, expect, it } from "vitest";
import { createDeferred, awaitGateBeforeSettlement } from "../../test/helpers/promise.js";
import {
  withAgentDeletion,
  type AgentDeletionOperation,
} from "../agents/agent-lifecycle-registry.js";
import {
  beginAgentDeletionJournal,
  readAgentDeletionJournal,
  readAgentDeletionJournalInDatabase,
} from "../state/agent-deletion-journal.js";
import { runBranchStateWriteTransaction } from "../state/branch-state-db.js";
import { withBranchTestState } from "../test-utils/branch-test-state.js";
import { releaseGroveRemoveRows } from "./lifecycle-delete-support.js";
import {
  deleteGroveInstallRecord,
  persistGroveInstallRecord,
  persistGroveMigrationOwnership,
  releaseAdoptedGroveInstallRecord,
  readGroveInstallRecord,
  updateGroveInstallRecord,
  updateGroveInstallRecordStatus,
} from "./provenance.js";
import { makeProvenancePlan } from "./provenance.test-helpers.js";

function deletionEntry(root: string, agentId = "worker") {
  return {
    agentId,
    agentDir: path.join(root, "agents", agentId),
    workspaceDir: path.join(root, `workspace-${agentId}`),
    sessionsDir: path.join(root, "agents", agentId, "sessions"),
    deleteFiles: false,
    databasePaths: [path.join(root, "agents", agentId, "branch-agent.sqlite")],
    cleanupPaths: [
      {
        path: path.join(root, `workspace-${agentId}`),
        canonicalPath: path.join(root, `workspace-${agentId}`),
        parentPath: root,
        kind: "target" as const,
        sourcePaths: [path.join(root, `workspace-${agentId}`)],
        dev: null,
        ino: null,
        coversDescendants: true,
        done: false,
      },
    ],
  };
}

describe("Grove installation identity during deletion", () => {
  it("fences foreign writes while cleanup waits and admits only its live retry owner", async () => {
    await withBranchTestState(
      { label: "grove-install-deletion", applyEnv: false },
      async ({ root, env }) => {
        const { plan } = await makeProvenancePlan(root, {
          schemaVersion: 1,
          agent: { id: "worker" },
        });
        const options = { env };
        const original = persistGroveInstallRecord(plan, {
          ...options,
          nowMs: 1,
          agentOrigin: "adopted",
        });
        const next = {
          ...plan,
          grove: { ...plan.grove, version: "2.0.0", integrity: "sha256:replacement" },
        };
        const paused = createDeferred<AgentDeletionOperation>();
        const resume = createDeferred();
        const removal = withAgentDeletion(
          "worker",
          async (begin) => {
            const deletion = await begin(deletionEntry(root));
            paused.resolve(deletion);
            await resume.promise;
            const beforeHandoff = readAgentDeletionJournal("worker", options);
            updateGroveInstallRecordStatus("worker", "partial", {
              ...options,
              nowMs: 2,
              deletionOperation: deletion,
            });
            const handedOff = readAgentDeletionJournal("worker", options);
            expect(handedOff).toEqual({ ...beforeHandoff, operationId: expect.any(String) });
            expect(handedOff?.operationId).not.toBe(deletion.entry.operationId);
            expect(handedOff?.cleanupCompleted).toBe(false);
            expect(() => deletion.assertCurrent()).toThrow("no longer owns");
            return deletion;
          },
          options,
        );
        let operation: AgentDeletionOperation;
        try {
          operation = await awaitGateBeforeSettlement(
            paused.promise,
            removal,
            "Deletion did not pause",
          );
          const journal = readAgentDeletionJournal("worker", options);
          expect(journal?.operationId).toBe(operation.entry.operationId);
          expect(() => updateGroveInstallRecord(next, options)).toThrow("pending deletion");
          expect(() => persistGroveMigrationOwnership(next, [], options)).toThrow(
            "pending deletion",
          );
          expect(() =>
            releaseAdoptedGroveInstallRecord("worker", original.planIntegrity, options),
          ).toThrow("pending deletion");
          expect(() => updateGroveInstallRecordStatus("worker", "partial", options)).toThrow(
            "pending deletion",
          );
          expect(() => deleteGroveInstallRecord("worker", options)).toThrow("pending deletion");
          expect(readGroveInstallRecord("worker", options)).toEqual(original);
          expect(readAgentDeletionJournal("worker", options)).toEqual(journal);
          await withAgentDeletion(
            "other",
            async (begin) => {
              const foreign = await begin(deletionEntry(root, "other"));
              try {
                expect(() =>
                  updateGroveInstallRecordStatus("worker", "partial", {
                    ...options,
                    deletionOperation: foreign,
                  }),
                ).toThrow("does not belong to the current deletion");
              } finally {
                await foreign.rollback();
              }
            },
            options,
          );
        } finally {
          resume.resolve();
          await removal;
        }
        expect(readGroveInstallRecord("worker", options)).toEqual({
          ...original,
          status: "partial",
          updatedAtMs: 2,
        });
        expect(() =>
          updateGroveInstallRecordStatus("worker", "partial", {
            ...options,
            deletionOperation: operation,
          }),
        ).toThrow("does not belong to the current deletion");
        await withAgentDeletion(
          "worker",
          async (begin) => {
            const recovery = await begin(deletionEntry(root));
            expect(() =>
              updateGroveInstallRecordStatus("worker", "partial", {
                ...options,
                deletionOperation: operation,
              }),
            ).toThrow("does not belong to the current deletion");
            expect(
              releaseGroveRemoveRows(
                "worker",
                [],
                [],
                recovery.assertCurrent,
                recovery.completeInTransaction,
                options,
              ),
            ).toBe(true);
          },
          options,
        );
        expect(readGroveInstallRecord("worker", options)).toBeUndefined();
        expect(readAgentDeletionJournal("worker", options)?.cleanupCompleted).toBe(true);
        expect(persistGroveInstallRecord(next, { ...options, nowMs: 3 }).grove.version).toBe("2.0.0");
      },
    );
  });

  it("rolls back the retry handoff and status together without revoking the restored owner", async () => {
    await withBranchTestState(
      { label: "grove-retry-handoff-rollback", applyEnv: false },
      async ({ root, env }) => {
        const { plan } = await makeProvenancePlan(root, {
          schemaVersion: 1,
          agent: { id: "worker" },
        });
        const options = { env };
        const original = persistGroveInstallRecord(plan, { ...options, nowMs: 1 });
        await withAgentDeletion(
          "worker",
          async (begin) => {
            const deletion = await begin(deletionEntry(root));
            const journal = readAgentDeletionJournal("worker", options);
            const failure = new Error("abort retry publication");
            expect(() =>
              runBranchStateWriteTransaction((database) => {
                updateGroveInstallRecordStatus("worker", "partial", {
                  ...options,
                  database,
                  nowMs: 2,
                  deletionOperation: deletion,
                });
                expect(
                  readAgentDeletionJournalInDatabase(database, "worker")?.operationId,
                ).not.toBe(deletion.entry.operationId);
                expect(() => deletion.assertCurrent(database)).toThrow("no longer owns");
                throw failure;
              }, options),
            ).toThrow(failure);
            expect(readAgentDeletionJournal("worker", options)).toEqual(journal);
            expect(readGroveInstallRecord("worker", options)).toEqual(original);
            expect(() => deletion.assertCurrent()).not.toThrow();
            await deletion.rollback();
          },
          options,
        );
        expect(readAgentDeletionJournal("worker", options)).toBeUndefined();
      },
    );
  });

  it.each(["missing", "legacy"] as const)(
    "keeps a %s install unchanged across an interrupted deletion until rollback",
    async (kind) => {
      await withBranchTestState(
        { label: `grove-install-deletion-${kind}`, applyEnv: false },
        async ({ root, env }) => {
          const { plan } = await makeProvenancePlan(root, {
            schemaVersion: 1,
            agent: { id: "worker" },
          });
          const options = { env };
          if (kind === "legacy") {
            persistGroveInstallRecord(plan, { ...options, status: "pending", nowMs: 1 });
            runBranchStateWriteTransaction(({ db }) => {
              db.prepare("UPDATE grove_installs SET schema_version = ? WHERE agent_id = ?").run(
                "branch.groveInstallRecord.v1",
                "worker",
              );
            }, options);
          }
          const original = readGroveInstallRecord("worker", options);
          beginAgentDeletionJournal(
            { ...deletionEntry(root), operationId: "interrupted-deletion" },
            options,
          );
          expect(() =>
            persistGroveInstallRecord(plan, {
              ...options,
              status: "pending",
              expectedExistingRecord: original,
            }),
          ).toThrow("pending deletion");
          expect(readGroveInstallRecord("worker", options)).toEqual(original);
          await withAgentDeletion(
            "worker",
            async (begin) => (await begin(deletionEntry(root))).rollback(),
            options,
          );
          expect(
            persistGroveInstallRecord(plan, {
              ...options,
              status: "pending",
              expectedExistingRecord: original,
            }).schemaVersion,
          ).toBe("branch.groveInstallRecord.v2");
        },
      );
    },
  );
});
