import { setTimeout as delay } from "node:timers/promises";
import type { BranchConfig } from "../config/types.branch.js";
import { createAbortError, racePromiseWithAbortSignal } from "../infra/abort-signal.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolvePublishedModelCatalogOwner } from "./prepared-model-catalog-owner.js";
import { assertPreparedModelRuntimeAdmissionCanWait } from "./prepared-model-runtime-admission.js";
import {
  PreparedModelRuntimeOwnerNotPublishedError,
  PreparedModelRuntimePublicationSupersededError,
} from "./prepared-model-runtime.errors.js";
import type {
  PreparedModelRuntimeOwner,
  PreparedReplyDispatchRuntime,
} from "./prepared-model-runtime.types.js";

const EMPTY_REPLY_DISPATCH_PUBLICATION: readonly PreparedReplyDispatchRuntime[] = Object.freeze([]);
const log = createSubsystemLogger("agents/prepared-reply-dispatch");

function createReplyDispatchRuntime(
  runtimeOwner: PreparedModelRuntimeOwner,
): PreparedReplyDispatchRuntime {
  const snapshot = runtimeOwner.snapshot!;
  const owner = resolvePublishedModelCatalogOwner(snapshot);
  const pluginGeneration = runtimeOwner.pluginGeneration;
  const inboundPluginRegistry = pluginGeneration?.inboundPluginRegistry;
  if (!pluginGeneration || !inboundPluginRegistry) {
    throw new PreparedModelRuntimeOwnerNotPublishedError(
      `prepared inbound plugin registry was not published for ${snapshot.agentDir}`,
    );
  }
  return Object.freeze({
    agentId: owner.agentId,
    agentDir: owner.agentDir,
    workspaceDir: owner.workspaceDir,
    config: owner.config,
    modelCatalog: owner.modelCatalog,
    readFullModelCatalog: snapshot.readFullModelCatalog,
    inboundPluginRegistry,
    pluginGeneration,
  });
}

type ReplyDispatchBuild = {
  runtimes: readonly PreparedReplyDispatchRuntime[];
  /** Configured agents with no published runtime yet; they are absent from dispatch until one exists. */
  excluded: ReadonlySet<string>;
};

function ownerDispatchKey(owner: PreparedModelRuntimeOwner): string {
  return owner.input.agentId ?? owner.input.agentDir;
}

/**
 * Builds one dispatch generation. A fresh owner gets a new runtime. A stale or still-building owner
 * keeps the runtime it last served, so a sibling's publish never takes it offline. An owner that
 * was never published (or was fenced by an auth mutation, which removes its runtime) is excluded
 * until its own publication adds it back.
 */
function buildReplyDispatchPublication(
  owners: Iterable<PreparedModelRuntimeOwner>,
  previous: readonly PreparedReplyDispatchRuntime[] = EMPTY_REPLY_DISPATCH_PUBLICATION,
): ReplyDispatchBuild {
  const lastServed = new Map(previous.map((runtime) => [runtime.agentId, runtime]));
  const runtimes: PreparedReplyDispatchRuntime[] = [];
  const excluded = new Set<string>();
  for (const owner of owners) {
    if (owner.provenance !== "configured") {
      continue;
    }
    if (owner.snapshot && !owner.needsRefresh && !owner.pending) {
      runtimes.push(createReplyDispatchRuntime(owner));
      continue;
    }
    const kept = owner.input.agentId === undefined ? undefined : lastServed.get(owner.input.agentId);
    if (kept) {
      runtimes.push(kept);
      continue;
    }
    excluded.add(ownerDispatchKey(owner));
  }
  runtimes.sort((left, right) => left.agentId.localeCompare(right.agentId));
  if (new Set(runtimes.map((runtime) => runtime.agentId)).size !== runtimes.length) {
    throw new PreparedModelRuntimeOwnerNotPublishedError(
      "prepared reply dispatch runtime publication contains duplicate configured agents",
    );
  }
  return { runtimes: Object.freeze(runtimes), excluded };
}

function logReplyDispatchChanges(
  previousExcluded: ReadonlySet<string>,
  next: ReplyDispatchBuild,
): void {
  for (const agentId of next.excluded) {
    if (!previousExcluded.has(agentId)) {
      log.warn(`reply dispatch excluded ${agentId}: it has no published runtime yet; its own publication adds it back`);
    }
  }
  for (const agentId of previousExcluded) {
    if (!next.excluded.has(agentId) && next.runtimes.some((runtime) => runtime.agentId === agentId)) {
      log.warn(`reply dispatch added back ${agentId}: its own publication committed`);
    }
  }
}

type PreparedReplyDispatchPublicationHost = Readonly<{
  isGatewayLifecycleActive: () => boolean;
  getConfiguredOwner: (agentId: string) => PreparedModelRuntimeOwner | undefined;
  getPendingReplacement: () => Promise<void> | undefined;
}>;

/** Reads one immutable configured Gateway dispatch generation without activating an owner. */
export class PreparedReplyDispatchPublicationOwner {
  #publication = EMPTY_REPLY_DISPATCH_PUBLICATION;
  #excluded: ReadonlySet<string> = new Set();

  constructor(private readonly host: PreparedReplyDispatchPublicationHost) {}

  clear(): void {
    this.#publication = EMPTY_REPLY_DISPATCH_PUBLICATION;
    this.#excluded = new Set();
  }

  advanceConfig(config: BranchConfig): void {
    this.#publication = Object.freeze(
      this.#publication.map((runtime) => Object.freeze({ ...runtime, config })),
    );
  }

  rebuild(owners: Iterable<PreparedModelRuntimeOwner>): void {
    this.#apply(this.#build(owners));
  }

  stage(owners: Iterable<PreparedModelRuntimeOwner>): () => void {
    const built = this.#build(owners);
    return () => {
      this.#apply(built);
    };
  }

  #build(owners: Iterable<PreparedModelRuntimeOwner>): ReplyDispatchBuild {
    return this.host.isGatewayLifecycleActive()
      ? buildReplyDispatchPublication(owners, this.#publication)
      : { runtimes: EMPTY_REPLY_DISPATCH_PUBLICATION, excluded: new Set() };
  }

  #apply(built: ReplyDispatchBuild): void {
    logReplyDispatchChanges(this.#excluded, built);
    this.#publication = built.runtimes;
    this.#excluded = built.excluded;
  }

  remove(agentIds: ReadonlySet<string>): void {
    if (agentIds.size > 0) {
      this.#publication = Object.freeze(
        this.#publication.filter((runtime) => !agentIds.has(runtime.agentId)),
      );
    }
  }

  replace(owners: readonly PreparedModelRuntimeOwner[]): void {
    const replacements = buildReplyDispatchPublication(owners).runtimes;
    const agentIds = new Set(replacements.map((runtime) => runtime.agentId));
    this.#publication = Object.freeze(
      [
        ...this.#publication.filter((runtime) => !agentIds.has(runtime.agentId)),
        ...replacements,
      ].toSorted((left, right) => left.agentId.localeCompare(right.agentId)),
    );
    if (this.#excluded.size > 0 && [...this.#excluded].some((agentId) => agentIds.has(agentId))) {
      const remaining = new Set([...this.#excluded].filter((agentId) => !agentIds.has(agentId)));
      logReplyDispatchChanges(this.#excluded, { runtimes: this.#publication, excluded: remaining });
      this.#excluded = remaining;
    }
  }

  readonly load = async ({
    agentId,
    abortSignal,
  }: {
    agentId: string;
    abortSignal?: AbortSignal;
  }): Promise<PreparedReplyDispatchRuntime | undefined> => {
    let supersededSince: number | undefined;
    const waitForSuccessor = async (error: PreparedModelRuntimePublicationSupersededError) => {
      supersededSince ??= Date.now();
      if (Date.now() - supersededSince >= 120_000) { throw error; }
      await racePromiseWithAbortSignal(delay(250), abortSignal);
    };
    for (;;) {
      if (abortSignal?.aborted) {
        throw createAbortError("Prepared reply dispatch admission aborted", {
          cause: abortSignal.reason,
        });
      }
      if (!this.host.isGatewayLifecycleActive()) {
        return undefined;
      }
      const replacement = this.host.getPendingReplacement();
      if (replacement) {
        assertPreparedModelRuntimeAdmissionCanWait();
        try {
          await racePromiseWithAbortSignal(replacement, abortSignal);
        } catch (error) {
          if (!(error instanceof PreparedModelRuntimePublicationSupersededError)){ throw error; }
          await waitForSuccessor(error);
        }
        continue;
      }
      const pendingOwner = this.host.getConfiguredOwner(agentId);
      if (pendingOwner?.pending) {
        assertPreparedModelRuntimeAdmissionCanWait(pendingOwner);
        try {
          await racePromiseWithAbortSignal(pendingOwner.pending, abortSignal);
        } catch (error) {
          if (!(error instanceof PreparedModelRuntimePublicationSupersededError)){ throw error; }
          await waitForSuccessor(error);
        }
        continue;
      }
      const runtime = this.#publication.find((candidate) => candidate.agentId === agentId);
      if (!runtime) {
        if (supersededSince && Date.now() - supersededSince < 120_000) {
          // A retired publication can settle before its replacement is queued.
          await racePromiseWithAbortSignal(delay(250), abortSignal);
          continue;
        }
        throw new PreparedModelRuntimeOwnerNotPublishedError(
          `prepared reply dispatch runtime owner was not published for ${agentId}`,
        );
      }
      return runtime;
    }
  };
}
