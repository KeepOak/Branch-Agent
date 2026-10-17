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
import {
  LEASE_CONTENTION_RETRY_MS,
  LEASE_CONTENTION_RETRY_TIMEOUT_MS,
} from "../../state/branch-state-lease-heartbeat-shared.js";

export const AGENT_CREATION_WITNESS_RACE =
  "Agent creation no longer owns its originally observed target";

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

function agentDatabaseExecutionCreationIsPending(options: BranchAgentDatabaseOptions): boolean {
  const pathname = resolveBranchAgentSqlitePath(options);
  const state = readGlobalSingleton(Symbol.for("branch.agentDatabaseExecutionOwners")) as
    | { owners?: Map<string, { kind?: string; creationIsPending?: () => boolean }> }
    | undefined;
  const existing =
    state?.owners?.get(pathname) ??
    state?.owners?.get(readDatabasePathIdentitySync(pathname).canonicalPath);
  return existing?.kind === "file" && existing.creationIsPending?.() === true;
}

function shouldRetryCreationWitness(
  error: unknown,
  signal: AbortSignal | undefined,
  deadline: number,
) {
  return (
    isAgentCreationWitnessRace(error) &&
    signal?.aborted !== true &&
    performance.now() < deadline
  );
}

/**
 * Capture the session-store actor for a just-created Trunk.
 * A concurrent first-open (config reload, admission warm-up, or first-run greeting)
 * may reserve the still-absent database. Wait and retry from a fresh observation
 * instead of failing `sessions.create` with the creation-witness race.
 */
export async function captureSessionStoreAgentDatabaseExecution(
  options: BranchAgentDatabaseOptions,
  params: {
    observed?: DatabasePathIdentity;
    signal?: AbortSignal;
  } = {},
): Promise<BranchAgentDatabaseExecution> {
  const pathname = resolveBranchAgentSqlitePath(options);
  const deadline = performance.now() + LEASE_CONTENTION_RETRY_TIMEOUT_MS;
  let observed = params.observed;
  for (;;) {
    params.signal?.throwIfAborted();
    const identity = observed ?? readDatabasePathIdentitySync(pathname);
    observed = undefined;
    let execution: BranchAgentDatabaseExecution | undefined;
    try {
      execution = captureBranchAgentDatabaseExecution(options, captureConstraints(identity));
    } catch (error) {
      if (!shouldRetryCreationWitness(error, params.signal, deadline)) {
        throw error;
      }
      await sleepWithAbort(LEASE_CONTENTION_RETRY_MS, params.signal);
      continue;
    }
    // A first-open may already own native birth. Borrowing the file is not enough;
    // prepare() still requires that owner's receipt. Wait, then recapture.
    if (
      execution.fileIdentity ||
      !identity.key.startsWith("file:") ||
      !agentDatabaseExecutionCreationIsPending(options)
    ) {
      return execution;
    }
    if (performance.now() >= deadline) {
      await execution.release();
      throw new Error(AGENT_CREATION_WITNESS_RACE);
    }
    await execution.release();
    await sleepWithAbort(LEASE_CONTENTION_RETRY_MS, params.signal);
  }
}
