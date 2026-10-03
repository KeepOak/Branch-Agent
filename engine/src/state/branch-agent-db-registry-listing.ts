import { AsyncLocalStorage } from "node:async_hooks";
import { lstatSync, statSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { cloneEnvWithPlatformSemantics } from "../config/config-env-vars.js";
import { resolveStateDir } from "../config/state-dir.js";
import { resolveSqliteDatabaseFilePaths } from "../infra/sqlite-files.js";
import { sessionChanges } from "../sessions/session-row-changes.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import {
  BRANCH_AGENT_SCHEMA_VERSION,
  type BranchAgentDatabaseRegistryReadResult,
  type BranchAgentDatabaseRegistrationCommit,
  type BranchRegisteredAgentDatabase,
} from "./branch-agent-db-contract.js";
import { readRegisteredAgentDatabaseRows } from "./branch-agent-db-registry.read.js";
import {
  isStateDatabaseReadAdmissionInvalidatedError,
  type BranchStateDatabaseReadAdmission,
} from "./branch-state-db-async-lifecycle.js";
import type { BranchStateDatabaseOptions } from "./branch-state-db-contract.js";
import {
  withExistingBranchStateDatabaseArtifactPreservingReadOnlyAsync,
  withExistingBranchStateDatabaseReadOnly,
  executeExistingBranchStateRead,
} from "./branch-state-db-readonly.js";
import { resolveDatabasePath } from "./branch-state-db.paths.js";
import { captureBranchStateWorkerContext } from "./branch-state-worker-context.js";
// Registry metadata is process-stable: registry writes invalidate after each commit;
// other-process changes take effect on restart. Polling here puts schema probes back on hot reads.
type AgentDatabaseRegistryMemo = {
  pathname: string;
  token: symbol;
  entries?: readonly BranchRegisteredAgentDatabase[];
};

// A plugin may first open a hot-created agent; its registration must invalidate
// native discovery even when subsequent callers reuse the shared connection.
const registry = resolveGlobalSingleton<{ memo?: AgentDatabaseRegistryMemo }>(
  Symbol.for("branch.agentDatabaseRegistryMemo"),
  () => ({}),
);

function activateRegisteredAgentDatabasesMemo(
  options: BranchStateDatabaseOptions,
): AgentDatabaseRegistryMemo {
  const pathname = resolveDatabasePath(options);
  if (registry.memo?.pathname !== pathname) {
    // One active pathname keeps registry metadata process-stable without retaining
    // an unbounded generation map. Switching back creates a fresh generation.
    registry.memo = { pathname, token: Symbol(pathname) };
  }
  return registry.memo;
}

/** Return the process-stable generation for the active agent database registry. */
export function readBranchAgentDatabaseRegistryToken(
  options: BranchStateDatabaseOptions = {},
): symbol {
  return activateRegisteredAgentDatabasesMemo(options).token;
}

/** An in-process witness from the canonical invalidator, never serialized as authority. */
export type AgentDatabaseRegistryChange = Readonly<{ previous: symbol; current: symbol }>;

export function invalidateRegisteredAgentDatabasesMemo(
  options: BranchStateDatabaseOptions,
): AgentDatabaseRegistryChange | undefined {
  const pathname = resolveDatabasePath(options);
  if (registry.memo?.pathname === pathname) {
    const previous = registry.memo.token;
    registry.memo = { pathname, token: Symbol(pathname) };
    return { previous, current: registry.memo.token };
  }
  return undefined;
}

/** Publish only registration witnessed at COMMIT, under its original shared generation. */
export function captureBranchAgentDatabaseRegistration(params: {
  agentId: string;
  agentPath: string;
  admission: BranchStateDatabaseReadAdmission;
  onRegistryChange?: (change: AgentDatabaseRegistryChange) => void;
}) {
  const options = { path: params.admission.databasePath };
  let active = false;
  let committed = false;
  let finished = false;
  return {
    begin() {
      if (finished) {
        throw new Error("Agent database registration admission is closed");
      }
      if (!active) {
        active = true;
        const change = invalidateRegisteredAgentDatabasesMemo(options);
        if (change) {
          params.onRegistryChange?.(change);
        }
      }
    },
    recordCommitted(receipt: BranchAgentDatabaseRegistrationCommit) {
      if (
        finished ||
        !active ||
        receipt.agentId !== params.agentId ||
        receipt.agentPath !== params.agentPath ||
        receipt.stateDatabasePath !== params.admission.databasePath ||
        receipt.stateDatabaseIdentity !== params.admission.identity.key
      ) {
        throw new Error("Agent registration commit differs from its captured owner");
      }
      committed = true;
    },
    finish() {
      if (finished) {
        return;
      }
      finished = true;
      try {
        params.admission.assertCurrent();
      } catch (error) {
        if (isStateDatabaseReadAdmissionInvalidatedError(error)) {
          return;
        }
        throw error;
      }
      try {
        const change = active ? invalidateRegisteredAgentDatabasesMemo(options) : undefined;
        if (change) {
          params.onRegistryChange?.(change);
        }
      } finally {
        if (committed) {
          sessionChanges.emit({ all: true, scope: { agentId: params.agentId, topology: true } });
        }
      }
    },
  };
}

function cloneRegisteredAgentDatabases(
  entries: readonly BranchRegisteredAgentDatabase[],
  options: AgentDatabaseRegistryListOptions,
): BranchRegisteredAgentDatabase[] {
  const cloned = entries.map((entry) => ({ ...entry }));
  return options.includeIncompatibleSchemaVersions
    ? cloned
    : cloned.filter((entry) => entry.schemaVersion === BRANCH_AGENT_SCHEMA_VERSION);
}

function hasUnavailableMissingSqlitePath(pathname: string): boolean {
  for (const candidate of resolveSqliteDatabaseFilePaths(pathname)) {
    try {
      lstatSync(candidate);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return true;
      }
    }
  }

  let ancestor = path.dirname(pathname);
  while (true) {
    try {
      const stat = lstatSync(ancestor);
      if (!stat.isSymbolicLink()) {
        return !stat.isDirectory();
      }
      try {
        return !statSync(ancestor).isDirectory();
      } catch {
        return true;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return true;
      }
    }
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      return false;
    }
    ancestor = parent;
  }
}

type AgentDatabaseRegistryListOptions = BranchStateDatabaseOptions & {
  includeIncompatibleSchemaVersions?: boolean;
};

export class AgentDatabaseRegistryChangedError extends Error {
  constructor() {
    super("Agent database registry changed during discovery; retry the read.");
    this.name = "AgentDatabaseRegistryChangedError";
  }
}

export function readRegisteredAgentDatabases(
  options: AgentDatabaseRegistryListOptions,
  artifactPreserving: false,
): BranchRegisteredAgentDatabase[];
export function readRegisteredAgentDatabases(
  options: AgentDatabaseRegistryListOptions,
  artifactPreserving: true,
): Promise<BranchRegisteredAgentDatabase[]>;
export function readRegisteredAgentDatabases(
  options: AgentDatabaseRegistryListOptions,
  artifactPreserving: boolean,
): BranchRegisteredAgentDatabase[] | Promise<BranchRegisteredAgentDatabase[]> {
  const pathname = resolveDatabasePath(options);
  const read = ({ db }: { db: DatabaseSync }) =>
    readRegisteredAgentDatabaseRows(db, pathname, artifactPreserving);
  const finish = (entries: BranchRegisteredAgentDatabase[] | undefined) => {
    if (entries === undefined) {
      if (hasUnavailableMissingSqlitePath(pathname)) {
        throw new Error(`Branch Agent state database ${pathname} is unavailable.`);
      }
      return [];
    }
    return options.includeIncompatibleSchemaVersions
      ? entries
      : entries.filter((entry) => entry.schemaVersion === BRANCH_AGENT_SCHEMA_VERSION);
  };
  return artifactPreserving
    ? withExistingBranchStateDatabaseArtifactPreservingReadOnlyAsync(read, options).then(finish)
    : finish(withExistingBranchStateDatabaseReadOnly(read, options));
}

/** Inspect a copied registry without creating SQLite artifacts or runtime memo state. */
export async function inspectBranchRegisteredAgentDatabases(
  options: AgentDatabaseRegistryListOptions = {},
): Promise<BranchRegisteredAgentDatabase[]> {
  return readRegisteredAgentDatabases(options, true);
}

/** List agent databases recorded in the shared Branch Agent state registry. */
export function listBranchRegisteredAgentDatabases(
  options: AgentDatabaseRegistryListOptions = {},
): BranchRegisteredAgentDatabase[] {
  const memo = activateRegisteredAgentDatabasesMemo(options);
  // Discovery runs per row in list hot paths, so the legacy-schema gate and the
  // query share one process-held state handle instead of opening two connections.
  const entries = (memo.entries ??= readRegisteredAgentDatabases(
    { ...options, includeIncompatibleSchemaVersions: true },
    false,
  ));
  return cloneRegisteredAgentDatabases(entries, options);
}

/** Capture authority now, but activate the canonical memo only if discovery needs it. */
export function prepareBranchAgentDatabaseRegistrySnapshotRead(
  inputOptions: AgentDatabaseRegistryListOptions = {},
): {
  assertCurrent: () => void;
  read(): Promise<{
    result: BranchAgentDatabaseRegistryReadResult;
    assertCurrent: () => void;
    followRegistration: (change: AgentDatabaseRegistryChange) => void;
  }>;
} {
  try {
    const env = cloneEnvWithPlatformSemantics(inputOptions.env ?? process.env);
    env.BRANCH_STATE_DIR = resolveStateDir(env);
    const options = {
      ...inputOptions,
      env,
      path: resolveDatabasePath({ ...inputOptions, env }),
    };
    const context = captureBranchStateWorkerContext(options);
    const inCapturedScope = AsyncLocalStorage.snapshot();
    let assertPreparedCurrent = () => context.admission.assertCurrent();
    return {
      assertCurrent: () => assertPreparedCurrent(),
      async read() {
        context.admission.assertCurrent();
        let memo = activateRegisteredAgentDatabasesMemo(options);
        let invalidated = false;
        const assertCurrent = () => {
          context.admission.assertCurrent();
          if (invalidated || registry.memo !== memo) {
            invalidated = true;
            throw new AgentDatabaseRegistryChangedError();
          }
        };
        const followRegistration = (change: AgentDatabaseRegistryChange) => {
          context.admission.assertCurrent();
          if (
            invalidated ||
            memo.token !== change.previous ||
            registry.memo?.pathname !== memo.pathname ||
            registry.memo.token !== change.current
          ) {
            invalidated = true;
            throw new Error("Agent registration cannot replace an invalidated registry read");
          }
          memo = registry.memo;
        };
        // Install the witness before the first await, including a read that later rejects.
        assertPreparedCurrent = assertCurrent;
        if (!memo.entries) {
          const reply = await inCapturedScope(() =>
            executeExistingBranchStateRead(options, { type: "agentDatabaseRegistry.read" }),
          );
          if (reply && (!reply.ok || reply.type !== "agentDatabaseRegistry.read")) {
            throw new Error("Unexpected agent database registry read result");
          }
          const result = reply?.result;
          assertCurrent();
          if (
            result?.status === "unavailable" ||
            (result === undefined && hasUnavailableMissingSqlitePath(options.path))
          ) {
            return { result: { status: "unavailable" }, assertCurrent, followRegistration };
          }
          memo.entries ??= result?.entries ?? [];
        }
        const entries = cloneRegisteredAgentDatabases(memo.entries, options);
        assertCurrent();
        return {
          result: { status: "available", entries },
          assertCurrent,
          followRegistration,
        };
      },
    };
  } catch (error) {
    return {
      assertCurrent() {
        throw error;
      },
      async read() {
        throw error;
      },
    };
  }
}
