import { sleepWithAbort } from "../../infra/backoff.js";
import {
  readDatabasePathIdentitySync,
  type DatabasePathIdentity,
} from "../../infra/sqlite-worker-identity.js";
import { readGlobalSingleton } from "../../shared/global-singleton.js";
import type { BranchAgentDatabaseOptions } from "../../state/branch-agent-db-contract.js";
import { resolveBranchAgentSqlitePath } from "../../state/branch-agent-db.paths.js";
import type {
  AgentDatabaseExecutionFileIdentity,
  BranchAgentDatabaseExecution,
} from "../../state/branch-agent-execution-contract.js";
import { captureBranchAgentDatabaseExecution } from "../../state/branch-agent-execution.js";
import { LEASE_CONTENTION_RETRY_MS } from "../../state/branch-state-lease-heartbeat-shared.js";

export const AGENT_CREATION_WITNESS_RACE =
  "Agent creation no longer owns its originally observed target";

/** Cold native first-open can outlast the 2s lease-contention budget (Windows). */
export const SESSION_STORE_FIRST_OPEN_TIMEOUT_MS = 15_000;

export const SESSION_STORE_FIRST_OPEN_PENDING =
  "The new Trunk's store is still opening. Try starting the conversation again in a moment.";

export function isAgentCreationWitnessRace(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(AGENT_CREATION_WITNESS_RACE);
}

function fileIdentityConstraints(identity: DatabasePathIdentity): {
  expectedIdentity: AgentDatabaseExecutionFileIdentity;
} {
  return {
    expectedIdentity: {
      kind: "file",
      physicalIdentity: identity.key.slice("file:".length),
      nativeLocation: identity.canonicalPath,
      birthtime: identity.birthtime,
    },
  };
}

function captureConstraints(identity: DatabasePathIdentity) {
  return identity.key.startsWith("file:")
    ? fileIdentityConstraints(identity)
    : { expectedCreationIdentity: identity };
}

type PeekedOwner = { kind?: string; creationIsPending?: () => boolean };

function agentDatabaseExecutionOwner(options: BranchAgentDatabaseOptions): PeekedOwner | undefined {
  const pathname = resolveBranchAgentSqlitePath(options);
  const state = readGlobalSingleton(Symbol.for("branch.agentDatabaseExecutionOwners")) as
    | { owners?: Map<string, PeekedOwner> }
    | undefined;
  return (
    state?.owners?.get(pathname) ??
    state?.owners?.get(readDatabasePathIdentitySync(pathname).canonicalPath)
  );
}

function reservedByConcurrentFirstOpen(options: BranchAgentDatabaseOptions): boolean {
  return agentDatabaseExecutionOwner(options)?.kind === "file";
}

function agentDatabaseExecutionCreationIsPending(options: BranchAgentDatabaseOptions): boolean {
  const existing = agentDatabaseExecutionOwner(options);
  return existing?.kind === "file" && existing.creationIsPending?.() === true;
}

function throwIfFirstOpenTimedOut(signal: AbortSignal | undefined, deadline: number): void {
  signal?.throwIfAborted();
  if (performance.now() >= deadline) {
    throw new Error(SESSION_STORE_FIRST_OPEN_PENDING);
  }
}

async function waitForFirstOpen(signal: AbortSignal | undefined, deadline: number): Promise<void> {
  throwIfFirstOpenTimedOut(signal, deadline);
  await sleepWithAbort(LEASE_CONTENTION_RETRY_MS, signal);
}

function isSameTargetFirstOpenRace(
  error: unknown,
  identity: DatabasePathIdentity,
  options: BranchAgentDatabaseOptions,
): boolean {
  return (
    isAgentCreationWitnessRace(error) &&
    (identity.key.startsWith("path:") ||
      reservedByConcurrentFirstOpen(options) ||
      agentDatabaseExecutionCreationIsPending(options))
  );
}

/**
 * Capture the session-store actor for a just-created Trunk.
 * A concurrent first-open (config reload, admission warm-up, or first-run greeting)
 * may reserve the still-absent database. That reservation is the same target:
 * wait until that owner finishes native birth, then recapture from a fresh file identity.
 */
export async function captureSessionStoreAgentDatabaseExecution(
  options: BranchAgentDatabaseOptions,
  params: {
    observed?: DatabasePathIdentity;
    signal?: AbortSignal;
  } = {},
): Promise<BranchAgentDatabaseExecution> {
  const pathname = resolveBranchAgentSqlitePath(options);
  const deadline = performance.now() + SESSION_STORE_FIRST_OPEN_TIMEOUT_MS;
  let observed = params.observed;
  if (observed?.key.startsWith("path:") && reservedByConcurrentFirstOpen(options)) {
    observed = undefined;
  }
  for (;;) {
    params.signal?.throwIfAborted();
    if (agentDatabaseExecutionCreationIsPending(options)) {
      await waitForFirstOpen(params.signal, deadline);
      observed = undefined;
      continue;
    }
    const identity = observed ?? readDatabasePathIdentitySync(pathname);
    observed = undefined;
    if (identity.key.startsWith("path:") && reservedByConcurrentFirstOpen(options)) {
      await waitForFirstOpen(params.signal, deadline);
      continue;
    }
    let execution: BranchAgentDatabaseExecution | undefined;
    try {
      execution = captureBranchAgentDatabaseExecution(options, captureConstraints(identity));
    } catch (error) {
      if (!isSameTargetFirstOpenRace(error, identity, options)) {
        throw error;
      }
      await waitForFirstOpen(params.signal, deadline);
      continue;
    }
    if (execution.fileIdentity || !agentDatabaseExecutionCreationIsPending(options)) {
      return execution;
    }
    await execution.release();
    await waitForFirstOpen(params.signal, deadline);
  }
}
