import { setTimeout as delay } from "node:timers/promises";
import type { BranchConfig } from "../config/types.branch.js";
import { createAbortError, racePromiseWithAbortSignal } from "../infra/abort-signal.js";
import { resolvePublishedModelCatalogOwner } from "./prepared-model-catalog-owner.js";
import type { PreparedModelRuntimeAdmissionBudget } from "./prepared-model-runtime-admission-budget.js";
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

function buildReplyDispatchPublication(
  owners: Iterable<PreparedModelRuntimeOwner>,
): readonly PreparedReplyDispatchRuntime[] {
  const runtimes = [...owners]
    .filter((owner) => owner.provenance === "configured")
    .map((owner) => {
      if (!owner.snapshot || owner.needsRefresh || owner.pending) {
        throw new PreparedModelRuntimeOwnerNotPublishedError(
          `prepared reply dispatch runtime owner was not published for ${owner.input.agentId ?? owner.input.agentDir}`,
        );
      }
      return createReplyDispatchRuntime(owner);
    })
    .toSorted((left, right) => left.agentId.localeCompare(right.agentId));
  if (new Set(runtimes.map((runtime) => runtime.agentId)).size !== runtimes.length) {
    throw new PreparedModelRuntimeOwnerNotPublishedError(
      "prepared reply dispatch runtime publication contains duplicate configured agents",
    );
  }
  return Object.freeze(runtimes);
}

type PreparedReplyDispatchPublicationHost = Readonly<{
  isGatewayLifecycleActive: () => boolean;
  getConfiguredOwner: (agentId: string) => PreparedModelRuntimeOwner | undefined;
  getPendingReplacement: () => Promise<void> | undefined;
}>;

/** Reads one immutable configured Gateway dispatch generation without activating an owner. */
export class PreparedReplyDispatchPublicationOwner {
  #publication = EMPTY_REPLY_DISPATCH_PUBLICATION;

  constructor(private readonly host: PreparedReplyDispatchPublicationHost) {}

  clear(): void {
    this.#publication = EMPTY_REPLY_DISPATCH_PUBLICATION;
  }

  advanceConfig(config: BranchConfig): void {
    this.#publication = Object.freeze(
      this.#publication.map((runtime) => Object.freeze({ ...runtime, config })),
    );
  }

  rebuild(owners: Iterable<PreparedModelRuntimeOwner>): void {
    this.#publication = this.host.isGatewayLifecycleActive()
      ? buildReplyDispatchPublication(owners)
      : EMPTY_REPLY_DISPATCH_PUBLICATION;
  }

  stage(owners: Iterable<PreparedModelRuntimeOwner>): () => void {
    const publication = this.host.isGatewayLifecycleActive()
      ? buildReplyDispatchPublication(owners)
      : EMPTY_REPLY_DISPATCH_PUBLICATION;
    return () => {
      this.#publication = publication;
    };
  }

  remove(agentIds: ReadonlySet<string>): void {
    if (agentIds.size > 0) {
      this.#publication = Object.freeze(
        this.#publication.filter((runtime) => !agentIds.has(runtime.agentId)),
      );
    }
  }

  replace(owners: readonly PreparedModelRuntimeOwner[]): void {
    const replacements = buildReplyDispatchPublication(owners);
    const agentIds = new Set(replacements.map((runtime) => runtime.agentId));
    this.#publication = Object.freeze(
      [
        ...this.#publication.filter((runtime) => !agentIds.has(runtime.agentId)),
        ...replacements,
      ].toSorted((left, right) => left.agentId.localeCompare(right.agentId)),
    );
  }

  readonly load = async ({
    agentId,
    abortSignal,
    admissionBudget,
  }: {
    agentId: string;
    abortSignal?: AbortSignal;
    admissionBudget?: PreparedModelRuntimeAdmissionBudget;
  }): Promise<PreparedReplyDispatchRuntime | undefined> => {
    let supersededSince: number | undefined;
    let lastPublication: Promise<unknown> | undefined;
    const publicationProgress = (publication: Promise<unknown>) => {
      if (publication !== lastPublication) {
        admissionBudget?.progress();
        lastPublication = publication;
      }
    };
    const waitForSuccessor = async (error: PreparedModelRuntimePublicationSupersededError) => {
      supersededSince ??= Date.now();
      admissionBudget?.recordSuperseded(error);
      if (!admissionBudget && Date.now() - supersededSince >= 120_000) {
        throw error;
      }
      await racePromiseWithAbortSignal(delay(250), abortSignal);
    };
    for (;;) {
      admissionBudget?.assert();
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
        publicationProgress(replacement);
        assertPreparedModelRuntimeAdmissionCanWait();
        try {
          await racePromiseWithAbortSignal(replacement, abortSignal);
        } catch (error) {
          if (!(error instanceof PreparedModelRuntimePublicationSupersededError)) {
            throw error;
          }
          await waitForSuccessor(error);
        }
        continue;
      }
      const pendingOwner = this.host.getConfiguredOwner(agentId);
      if (pendingOwner?.pending) {
        publicationProgress(pendingOwner.pending);
        assertPreparedModelRuntimeAdmissionCanWait(pendingOwner);
        try {
          await racePromiseWithAbortSignal(pendingOwner.pending, abortSignal);
        } catch (error) {
          if (!(error instanceof PreparedModelRuntimePublicationSupersededError)) {
            throw error;
          }
          await waitForSuccessor(error);
        }
        continue;
      }
      const runtime = this.#publication.find((candidate) => candidate.agentId === agentId);
      if (!runtime) {
        if (
          supersededSince !== undefined &&
          (admissionBudget || Date.now() - supersededSince < 120_000)
        ) {
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
