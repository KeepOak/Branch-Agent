import { listAgentIds } from "../agents/agent-scope.js";
import { isQueueEligibleTrunk } from "../agents/trunk-queue-policy.js";
import { resolveStateDir } from "../config/state-dir.js";
import type { BranchConfig } from "../config/types.branch.js";
import { dispatchSignalWake } from "../infra/signal-wakes/signal-wake-dispatch.js";
import {
  createSignalWakeGitHub,
  type RepoRef,
  type SignalWakeGitHubReads,
} from "../infra/signal-wakes/signal-wake-github.js";
import {
  startSignalWakePoller,
  type PrObservation,
  type SignalPoller,
} from "../infra/signal-wakes/signal-wake-poller.js";
import {
  createFileSignalStateStore,
  signalWakeStatePath,
} from "../infra/signal-wakes/signal-wake-state.js";
import { normalizeAgentId } from "../routing/session-key.js";
import { githubApiToken } from "./github-public-api.js";

const NOOP_POLLER: SignalPoller = { tick: async () => {}, stop: async () => {} };

/** Parses validated `owner/name` strings. Empty parts are dropped rather than polled. */
export function parseSignalWakeRepos(values: readonly string[] | undefined): RepoRef[] {
  return (values ?? []).flatMap((value) => {
    const [owner = "", name = ""] = value.split("/");
    return owner && name ? [{ owner, name }] : [];
  });
}

/** Trunks configured on this machine: the queue-eligible agents, which include the listed ones. */
export function configuredTrunkIds(cfg: BranchConfig): string[] {
  return listAgentIds(cfg)
    .map((id) => normalizeAgentId(id))
    .filter((id) => isQueueEligibleTrunk(id, cfg));
}

/** The gateway's one GitHub reader, shared by the signal poller and the Gardener. Undefined without a token. */
export function createGatewayGitHubReads(cfg: BranchConfig): SignalWakeGitHubReads | undefined {
  const token = githubApiToken(process.env, cfg);
  return token ? createSignalWakeGitHub({ fetchImpl: fetch, token }) : undefined;
}

/**
 * Starts the single gateway poller only when agents.signalWakes.repos names a repository. It reads through the
 * shared client, and `observe` taps each poll's data for the Gardener without a second read.
 */
export function startSignalWakePollerForGateway(params: {
  getRuntimeConfig: () => BranchConfig;
  /** The gateway's shared client. Omitted callers get a client built from the same token lookup. */
  github?: SignalWakeGitHubReads | undefined;
  observe?: (observation: PrObservation) => void;
  onError: (message: string) => void;
}): SignalPoller {
  const cfg = params.getRuntimeConfig();
  const repos = parseSignalWakeRepos(cfg.agents?.signalWakes?.repos);
  if (repos.length === 0) {
    return NOOP_POLLER;
  }
  const github = params.github ?? createGatewayGitHubReads(cfg);
  if (!github) {
    params.onError("signal wakes are configured but no GitHub token is available");
    return NOOP_POLLER;
  }
  return startSignalWakePoller({
    github,
    repos,
    trunkIds: () => configuredTrunkIds(params.getRuntimeConfig()),
    notify: (signal) => dispatchSignalWake(params.getRuntimeConfig(), signal),
    ...(params.observe ? { observe: params.observe } : {}),
    store: createFileSignalStateStore(signalWakeStatePath(resolveStateDir(process.env))),
    onError: params.onError,
  });
}
