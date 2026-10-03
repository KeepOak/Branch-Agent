import type { SqliteWorkerCommand } from "../infra/sqlite-worker-contract.js";
import type {
  BranchStateDatabase,
  BranchStateDatabaseOptions,
} from "../state/branch-state-db-contract.js";
import { runBranchStateWriteTransaction } from "../state/branch-state-db.js";
import { assertBranchStateLeaseWorkerOwnedInTransaction } from "../state/branch-state-lease-worker.js";
import {
  ensureProjectRegistrySchema,
  insertProjectRegistryInDatabase,
  listProjectRegistryInDatabase,
  removeProjectRegistryInDatabase,
  resolveProjectCloneRefreshOwnerInDatabase,
  resolveProjectRegistryInDatabase,
  resolveRecordedProjectRootInDatabase,
} from "./project-registry.kernel.js";
import type {
  ProjectCheckoutLeaseInput,
  ProjectRegistryWorkerOperations,
} from "./project-registry.worker-contract.js";

export function isProjectRegistryCommand(command: {
  type: string;
  input: unknown;
}): command is SqliteWorkerCommand<ProjectRegistryWorkerOperations> {
  switch (command.type) {
    case "projects.findRoot":
    case "projects.list":
    case "projects.resolve":
    case "projects.insert":
    case "projects.remove":
    case "projects.resolveRefreshOwner":
      return true;
    default:
      return false;
  }
}

export function executeProjectRegistryCommand(
  command: SqliteWorkerCommand<ProjectRegistryWorkerOperations>,
  options: BranchStateDatabaseOptions & { database: BranchStateDatabase },
): ProjectRegistryWorkerOperations[keyof ProjectRegistryWorkerOperations]["output"] {
  if (command.type === "projects.remove") {
    return runCheckoutLeaseTransaction(command.input, options, "projects.registry.remove", (db) =>
      removeProjectRegistryInDatabase(db, command.input.project),
    );
  }
  ensureProjectRegistrySchema(options);
  const db = options.database.db;
  if (command.type === "projects.findRoot") {
    return resolveRecordedProjectRootInDatabase(db, command.input.repoRoot);
  }
  if (command.type === "projects.list") {
    return listProjectRegistryInDatabase(db);
  }
  if (command.type === "projects.resolve") {
    return resolveProjectRegistryInDatabase(db, command.input.id);
  }
  if (command.type === "projects.insert") {
    return runCheckoutLeaseTransaction(command.input, options, "projects.registry.insert", (tx) =>
      insertProjectRegistryInDatabase(tx, command.input.project),
    );
  }
  return runCheckoutLeaseTransaction(
    command.input,
    options,
    "projects.registry.refresh-owner.resolve",
    (tx) => resolveProjectCloneRefreshOwnerInDatabase(tx, command.input.project),
  );
}

// Registry writes are admitted only under the checkout lease for the same repo root.
function runCheckoutLeaseTransaction<T>(
  input: ProjectCheckoutLeaseInput<{ repoRoot: string }>,
  options: BranchStateDatabaseOptions,
  operationLabel: string,
  operation: (db: BranchStateDatabase["db"]) => T,
): T {
  return runBranchStateWriteTransaction(
    ({ db }) => {
      const { project, lease } = input;
      if (lease.scope !== "projects.checkout" || lease.key !== project.repoRoot) {
        throw new Error("Project registry write requires its checkout lifecycle lease");
      }
      assertBranchStateLeaseWorkerOwnedInTransaction(db, lease);
      return operation(db);
    },
    options,
    { operationLabel },
  );
}
