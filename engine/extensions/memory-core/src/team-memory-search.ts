import { listAgentIds, type BranchConfig } from "branch/plugin-sdk/memory-core-host-runtime-core";
import type { MemorySearchResult } from "branch/plugin-sdk/memory-core-host-runtime-files";
import type { MemoryCoreAcquireLocalService } from "./memory/embedding-local-service.js";
import { getMemoryManagerContextWithPurpose } from "./tools.shared.js";

export type TeamMemoryHit = {
  agentId: string;
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
};

export type TeamMemorySearchOutcome = {
  results: TeamMemoryHit[];
  skippedAgentIds: string[];
};

type TeamMemorySearcher = {
  search(
    query: string,
    opts: { maxResults: number; minScore?: number },
  ): Promise<MemorySearchResult[]>;
  close?(): Promise<void>;
};

export type TeamMemoryLookup = { manager: TeamMemorySearcher } | { error: string | undefined };

type TeamMemorySearchParams = {
  agentIds: readonly string[];
  query: string;
  maxResults: number;
  minScore?: number;
  signal?: AbortSignal;
  closeAfterSearch?: boolean;
  lookupManager: (agentId: string) => Promise<TeamMemoryLookup>;
};

type AgentOutcome = { agentId: string; hits: TeamMemoryHit[] } | { agentId: string; failed: true };

// Only durable notes are shared. Session transcripts and untrusted content stay with their owner.
export function isTeamShareableHit(result: MemorySearchResult): boolean {
  if (result.source !== "memory" || isAbsolutePath(result.path)) {
    return false;
  }
  return result.provenance?.originClass !== "untrusted" && result.originClass !== "untrusted";
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || value.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(value);
}

function toTeamHit(agentId: string, result: MemorySearchResult): TeamMemoryHit {
  return {
    agentId,
    path: result.path,
    startLine: result.startLine,
    endLine: result.endLine,
    score: result.score,
    snippet: result.snippet,
  };
}

async function searchAgent(params: TeamMemorySearchParams, agentId: string): Promise<AgentOutcome> {
  try {
    const lookup = await params.lookupManager(agentId);
    if ("error" in lookup) {
      return { agentId, failed: true };
    }
    const found = await lookup.manager.search(params.query, {
      maxResults: params.maxResults,
      ...(params.minScore !== undefined ? { minScore: params.minScore } : {}),
    });
    if (params.closeAfterSearch) {
      await lookup.manager.close?.();
    }
    const hits = found.filter(isTeamShareableHit).map((result) => toTeamHit(agentId, result));
    return { agentId, hits };
  } catch {
    return { agentId, failed: true };
  }
}

export async function searchTeamMemory(
  params: TeamMemorySearchParams,
): Promise<TeamMemorySearchOutcome> {
  params.signal?.throwIfAborted();
  const outcomes = await Promise.all(
    params.agentIds.map((agentId) => searchAgent(params, agentId)),
  );
  params.signal?.throwIfAborted();
  const results = outcomes
    .flatMap((outcome) => ("hits" in outcome ? outcome.hits : []))
    .sort((left, right) => right.score - left.score)
    .slice(0, params.maxResults);
  const skippedAgentIds = outcomes
    .filter((outcome) => "failed" in outcome)
    .map((outcome) => outcome.agentId);
  return { results, skippedAgentIds };
}

export async function searchTeamMemoryCorpus(params: {
  cfg: BranchConfig;
  query: string;
  maxResults: number;
  minScore?: number;
  signal?: AbortSignal;
  oneShotCliRun?: boolean;
  acquireLocalService?: MemoryCoreAcquireLocalService;
}): Promise<TeamMemorySearchOutcome> {
  const purpose = params.oneShotCliRun ? "cli" : undefined;
  return searchTeamMemory({
    agentIds: listAgentIds(params.cfg),
    query: params.query,
    maxResults: params.maxResults,
    ...(params.minScore !== undefined ? { minScore: params.minScore } : {}),
    ...(params.signal ? { signal: params.signal } : {}),
    closeAfterSearch: purpose === "cli",
    lookupManager: (agentId) =>
      getMemoryManagerContextWithPurpose({
        cfg: params.cfg,
        agentId,
        purpose,
        acquireLocalService: params.acquireLocalService,
      }),
  });
}
