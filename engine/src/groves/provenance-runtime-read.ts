import { AsyncLocalStorage } from "node:async_hooks";
import type { DatabaseSync } from "node:sqlite";
import { formatErrorMessage } from "../infra/errors.js";
import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { assertBranchStateDatabaseOwner } from "../state/branch-state-db-maintenance.js";
import {
  isArtifactPreservingStateRead,
  withExistingBranchStateDatabaseArtifactPreservingReadOnly,
  withExistingBranchStateDatabaseReadOnly,
} from "../state/branch-state-db-readonly.js";
import {
  registerBranchStateDatabaseLifecycleListener,
  type BranchStateDatabaseOptions,
} from "../state/branch-state-db.js";
import { resolveDatabasePath } from "../state/branch-state-db.paths.js";
import { captureBranchStateWorkerContext } from "../state/branch-state-worker-context.js";
import { runBranchStateWorkerOperation } from "../state/branch-state-worker-store.js";
import {
  readGroveInstallSchemaVersionRows,
  type GroveInstallSchemaVersionRow,
} from "./provenance-runtime-read.kernel.js";
import { parseGroveInstallRecordSchemaVersion } from "./provenance-schema-version.js";

type GroveInstallSchemaVersionRead =
  | {
      kind: "ok";
      schemaVersion: ReturnType<typeof parseGroveInstallRecordSchemaVersion>;
      agentConfigDigest: string;
    }
  | { kind: "error"; error: unknown };

type GroveInstallSchemaVersionSnapshot =
  | { kind: "ready"; schemaVersions: Map<string, GroveInstallSchemaVersionRead> }
  | {
      kind: "state-error";
      error: unknown;
      knownAgentIds: ReadonlySet<string>;
      ownershipUnknown: boolean;
    }
  | { kind: "uninitialized" };

type GroveInstallSchemaVersionReadOptions = BranchStateDatabaseOptions & {
  artifactPreservingReadOnly?: boolean;
};

// Refresh on every runtime config snapshot because another process may mutate Grove provenance.
const snapshotsByPath = new Map<string, GroveInstallSchemaVersionSnapshot>();
const snapshotListeners = new Set<() => void>();
const handedOffFacts = resolveGlobalSingleton(
  Symbol.for("branch.groveInstallSchemaVersionFacts"),
  () =>
    new AsyncLocalStorage<{
      path: string;
      snapshot: GroveInstallSchemaVersionSnapshot;
      active: boolean;
    }>(),
);

function notifySnapshotListeners(): void {
  for (const listener of snapshotListeners) {
    listener();
  }
}

function decodeSchemaVersions(
  rows: GroveInstallSchemaVersionRow[],
): GroveInstallSchemaVersionSnapshot {
  const schemaVersions = new Map<string, GroveInstallSchemaVersionRead>();
  for (const row of rows) {
    try {
      schemaVersions.set(row.agentId, {
        kind: "ok",
        schemaVersion: parseGroveInstallRecordSchemaVersion(row.schemaVersion),
        agentConfigDigest: row.agentConfigDigest,
      });
    } catch (error) {
      schemaVersions.set(row.agentId, { kind: "error", error });
    }
  }
  return { kind: "ready", schemaVersions };
}

function readSchemaVersions(db: DatabaseSync): GroveInstallSchemaVersionSnapshot {
  try {
    return decodeSchemaVersions(readGroveInstallSchemaVersionRows(db));
  } catch (error) {
    return {
      kind: "state-error",
      error,
      knownAgentIds: new Set(),
      ownershipUnknown: true,
    };
  }
}

function knownAgentIds(
  snapshot: GroveInstallSchemaVersionSnapshot | undefined,
): ReadonlySet<string> {
  if (snapshot?.kind === "ready") {
    return new Set(snapshot.schemaVersions.keys());
  }
  return snapshot?.kind === "state-error" ? snapshot.knownAgentIds : new Set();
}

function isOwnershipUnknown(snapshot: GroveInstallSchemaVersionSnapshot | undefined): boolean {
  return (
    !snapshot ||
    snapshot.kind === "uninitialized" ||
    (snapshot.kind === "state-error" && snapshot.ownershipUnknown)
  );
}

registerBranchStateDatabaseLifecycleListener((event) => {
  if (event.kind === "failure-cleared") {
    return;
  }
  const previous = snapshotsByPath.get(event.kind === "opened" ? event.database.path : event.path);
  if (event.kind === "opened") {
    const snapshot = readSchemaVersions(event.database.db);
    snapshotsByPath.set(
      event.database.path,
      snapshot.kind === "state-error"
        ? {
            ...snapshot,
            knownAgentIds: knownAgentIds(previous),
            ownershipUnknown: isOwnershipUnknown(previous),
          }
        : snapshot,
    );
  } else if (event.kind === "open-error" || event.kind === "terminal-failure") {
    snapshotsByPath.set(event.path, {
      kind: "state-error",
      error: event.error,
      knownAgentIds: knownAgentIds(previous),
      ownershipUnknown: isOwnershipUnknown(previous),
    });
  } else {
    snapshotsByPath.set(event.path, {
      kind: "state-error",
      error: new Error("Branch Agent state database closed before consent provenance verification."),
      knownAgentIds: knownAgentIds(previous),
      ownershipUnknown: isOwnershipUnknown(previous),
    });
  }
  notifySnapshotListeners();
});

function resolveSnapshotPath(options: BranchStateDatabaseOptions): string {
  return options.database?.path ?? resolveDatabasePath(options);
}

/** Discovery workers consume the host's prepared facts, including failed or missing preparation. */
export function captureGroveInstallSchemaVersionFacts(options: BranchStateDatabaseOptions = {}) {
  const path = resolveSnapshotPath(options);
  const snapshot = readCachedGroveInstallSchemaVersions(options);
  if (snapshot.kind === "ready") {
    return {
      path,
      snapshot: {
        kind: snapshot.kind,
        schemaVersions: [...snapshot.schemaVersions].map(
          ([agentId, read]) =>
            [
              agentId,
              read.kind === "error" ? { ...read, error: formatErrorMessage(read.error) } : read,
            ] as const,
        ),
      },
    };
  }
  return {
    path,
    snapshot:
      snapshot.kind === "state-error"
        ? {
            ...snapshot,
            error: formatErrorMessage(snapshot.error),
            knownAgentIds: [...snapshot.knownAgentIds],
          }
        : snapshot,
  };
}

/** Includes late plugin imports, whose config preparers run immediately on registration. */
export function withGroveInstallSchemaVersionFacts<T>(
  facts: ReturnType<typeof captureGroveInstallSchemaVersionFacts>,
  operation: () => Promise<T>,
): Promise<T> {
  const snapshot: GroveInstallSchemaVersionSnapshot =
    facts.snapshot.kind === "ready"
      ? { ...facts.snapshot, schemaVersions: new Map(facts.snapshot.schemaVersions) }
      : facts.snapshot.kind === "state-error"
        ? { ...facts.snapshot, knownAgentIds: new Set(facts.snapshot.knownAgentIds) }
        : facts.snapshot;
  const scope = { path: facts.path, snapshot, active: true };
  return handedOffFacts.run(scope, async () => {
    try {
      return await operation();
    } finally {
      scope.active = false;
    }
  });
}

function readHandedOffFacts(options: BranchStateDatabaseOptions) {
  const scope = handedOffFacts.getStore();
  if (!scope) {
    return undefined;
  }
  if (!scope.active || scope.path !== resolveSnapshotPath(options)) {
    throw new Error("Grove provenance facts are outside their captured state scope.");
  }
  return scope.snapshot;
}

export function readCachedGroveInstallSchemaVersions(
  options: BranchStateDatabaseOptions = {},
): GroveInstallSchemaVersionSnapshot {
  return (
    readHandedOffFacts(options) ??
    snapshotsByPath.get(resolveSnapshotPath(options)) ?? { kind: "uninitialized" }
  );
}

export function initializeCachedGroveInstallSchemaVersions(
  options: GroveInstallSchemaVersionReadOptions = {},
): void {
  if (readHandedOffFacts(options)) {
    notifySnapshotListeners();
    return;
  }
  const path = resolveSnapshotPath(options);
  const previous = snapshotsByPath.get(path);
  try {
    const read =
      options.artifactPreservingReadOnly === false
        ? withExistingBranchStateDatabaseReadOnly
        : withExistingBranchStateDatabaseArtifactPreservingReadOnly;
    const snapshot = read(({ db, path: pathname }) => {
      assertBranchStateDatabaseOwner(db, { pathname });
      return readSchemaVersions(db);
    }, options);
    snapshotsByPath.set(path, resolveSchemaVersionSnapshot(snapshot, previous));
  } catch (error) {
    snapshotsByPath.set(path, {
      kind: "state-error",
      error,
      knownAgentIds: knownAgentIds(previous),
      ownershipUnknown: true,
    });
  }
  notifySnapshotListeners();
}

function resolveSchemaVersionSnapshot(
  snapshot: GroveInstallSchemaVersionSnapshot | undefined,
  previous: GroveInstallSchemaVersionSnapshot | undefined,
): GroveInstallSchemaVersionSnapshot {
  if (snapshot) {
    return snapshot;
  }
  const previousAgentIds = knownAgentIds(previous);
  return previousAgentIds.size > 0 || (previous !== undefined && isOwnershipUnknown(previous))
    ? {
        kind: "state-error",
        error: new Error("Branch Agent state database disappeared after Grove ownership was observed."),
        knownAgentIds: previousAgentIds,
        ownershipUnknown: true,
      }
    : { kind: "ready", schemaVersions: new Map() };
}

export async function prepareGroveInstallSchemaVersions(
  options: GroveInstallSchemaVersionReadOptions = {},
): Promise<{ path: string; publish: () => void }> {
  const path = resolveSnapshotPath(options);
  const previous = snapshotsByPath.get(path);
  let snapshot: GroveInstallSchemaVersionSnapshot;
  let assertCurrent: (() => void) | undefined;
  try {
    const context = captureBranchStateWorkerContext({ path, env: options.env });
    assertCurrent = context.admission.assertCurrent;
    const rows = await runBranchStateWorkerOperation(
      context,
      (scope) =>
        scope.execute({
          type: "groves.install-schema-versions",
          input: {
            artifactPreservingReadOnly:
              options.artifactPreservingReadOnly !== false || isArtifactPreservingStateRead(),
          },
        }),
      { existingOnly: true },
    );
    snapshot = resolveSchemaVersionSnapshot(
      rows === undefined ? undefined : decodeSchemaVersions(rows),
      previous,
    );
  } catch (error) {
    snapshot = {
      kind: "state-error",
      error,
      knownAgentIds: knownAgentIds(previous),
      ownershipUnknown: true,
    };
  }
  return {
    path,
    publish: () => {
      const current = snapshotsByPath.get(path);
      // Lifecycle changes and committed Grove writes supersede the staged read.
      if (current !== previous) {
        return;
      }
      try {
        if (resolveSnapshotPath(options) !== path) {
          throw new Error("Branch Agent state location changed before consent provenance publication.");
        }
        assertCurrent?.();
      } catch (error) {
        snapshot = {
          kind: "state-error",
          error,
          knownAgentIds: knownAgentIds(current),
          ownershipUnknown: true,
        };
      }
      snapshotsByPath.set(path, snapshot);
      notifySnapshotListeners();
    },
  };
}

export function registerGroveInstallSchemaVersionSnapshotListener(listener: () => void): () => void {
  snapshotListeners.add(listener);
  return () => snapshotListeners.delete(listener);
}

export function cacheGroveInstallSchemaVersion(
  agentId: string,
  schemaVersion: ReturnType<typeof parseGroveInstallRecordSchemaVersion>,
  agentConfigDigest: string,
  options: BranchStateDatabaseOptions = {},
): void {
  const snapshot = snapshotsByPath.get(resolveSnapshotPath(options));
  if (snapshot?.kind !== "ready") {
    return;
  }
  snapshot.schemaVersions.set(agentId, { kind: "ok", schemaVersion, agentConfigDigest });
  snapshotsByPath.set(resolveSnapshotPath(options), { ...snapshot });
  notifySnapshotListeners();
}

export function deleteCachedGroveInstallSchemaVersion(
  agentId: string,
  options: BranchStateDatabaseOptions = {},
): void {
  const snapshot = snapshotsByPath.get(resolveSnapshotPath(options));
  if (snapshot?.kind !== "ready" || !snapshot.schemaVersions.delete(agentId)) {
    return;
  }
  snapshotsByPath.set(resolveSnapshotPath(options), { ...snapshot });
  notifySnapshotListeners();
}
