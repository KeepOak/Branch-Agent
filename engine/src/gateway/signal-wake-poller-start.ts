import { listAgentIds } from "../agents/agent-scope.js";
import { isQueueEligibleTrunk } from "../agents/trunk-queue-policy.js";
import { resolveStateDir } from "../config/state-dir.js";
import type { BranchConfig } from "../config/types.branch.js";
import { dispatchSignalWake } from "../infra/signal-wakes/signal-wake-dispatch.js";
import { createSignalWakeGitHub, type RepoRef } from "../infra/signal-wakes/signal-wake-github.js";
import {
  startSignalWakePoller,
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

/** Starts the single gateway poller only when agents.signalWakes.repos names a repository. */
export function startSignalWakePollerForGateway(params: {
  getRuntimeConfig: () => BranchConfig;
  onError: (message: string) => void;
}): SignalPoller {
  const cfg = params.getRuntimeConfig();
  const repos = parseSignalWakeRepos(cfg.agents?.signalWakes?.repos);
  if (repos.length === 0) {
    return NOOP_POLLER;
  }
  const token = githubApiToken(process.env, cfg);
  if (!token) {
    params.onError("signal wakes are configured but no GitHub token is available");
    return NOOP_POLLER;
  }
  return startSignalWakePoller({
    github: createSignalWakeGitHub({ fetchImpl: fetch, token }),
    repos,
    trunkIds: () => configuredTrunkIds(params.getRuntimeConfig()),
    notify: (signal) => dispatchSignalWake(params.getRuntimeConfig(), signal),
    store: createFileSignalStateStore(signalWakeStatePath(resolveStateDir(process.env))),
    onError: params.onError,
  });
}
