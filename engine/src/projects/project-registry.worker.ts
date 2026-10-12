import type { DatabaseSync } from "node:sqlite";
import { runBranchStateWriteTransaction } from "../state/branch-state-db.js";
import { assertBranchStateLeaseWorkerOwnedInTransaction } from "../state/branch-state-lease-worker.js";
import type { BranchStateLeaseIdentity } from "../state/branch-state-lease.types.js";
import type {
  WorkerOperationContext,
  WorkerOperationHandlers,
} from "../state/worker-operation-registry.js";
import {
  ensureProjectRegistrySchema,
  insertProjectRegistryInDatabase,
  listProjectRegistryInDatabase,
  removeProjectCheckoutReferenceInDatabase,
  removeProjectRegistryInDatabase,
  resolveProjectCloneRefreshOwnerInDatabase,
  resolveProjectRegistryInDatabase,
  resolveRecordedProjectRootInDatabase,
} from "./project-registry.kernel.js";

// Registry writes are admitted only under the checkout lease for the same repo root.
function checkoutTransaction<Project extends { repoRoot: string }, Output>(
  operationLabel: string,
  operation: (db: DatabaseSync, project: Project) => Output,
) {
  return (
    { project, lease }: { project: Project; lease: BranchStateLeaseIdentity },
    { open, stateOptions }: WorkerOperationContext,
  ): Output =>
    runBranchStateWriteTransaction(
      ({ db }) => {
        if (lease.scope !== "projects.checkout" || lease.key !== project.repoRoot) {
          throw new Error("Project registry write requires its checkout lifecycle lease");
        }
        assertBranchStateLeaseWorkerOwnedInTransaction(db, lease);
        return operation(db, project);
      },
      { database: open(), ...stateOptions() },
      { operationLabel },
    );
}

function registryDatabase({ open, stateOptions }: WorkerOperationContext): DatabaseSync {
  const database = open();
  ensureProjectRegistrySchema({ database, ...stateOptions() });
  return database.db;
}

export const projectRegistryOperations = {
  "projects.findRoot": (input: { repoRoot: string }, context) =>
    resolveRecordedProjectRootInDatabase(registryDatabase(context), input.repoRoot),
  "projects.list": (_input: undefined, context) =>
    listProjectRegistryInDatabase(registryDatabase(context)),
  "projects.resolve": (input: { id: string }, context) =>
    resolveProjectRegistryInDatabase(registryDatabase(context), input.id),
  "projects.insert": checkoutTransaction(
    "projects.registry.insert",
    insertProjectRegistryInDatabase,
  ),
  "projects.remove": checkoutTransaction(
    "projects.registry.remove",
    removeProjectRegistryInDatabase,
  ),
  "projects.resolveRefreshOwner": checkoutTransaction(
    "projects.registry.refresh-owner.resolve",
    resolveProjectCloneRefreshOwnerInDatabase,
  ),
  "projects.removeCheckoutReference": checkoutTransaction(
    "projects.registry.checkout-reference.remove",
    removeProjectCheckoutReferenceInDatabase,
  ),
} satisfies WorkerOperationHandlers;
