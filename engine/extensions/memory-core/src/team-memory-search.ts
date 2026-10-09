import fs from "node:fs/promises";
import path from "node:path";
import {
  listAgentIds,
  listOutsideAgentIdentityIds,
  type BranchConfig,
} from "branch/plugin-sdk/memory-core-host-runtime-core";
import type { MemorySearchResult } from "branch/plugin-sdk/memory-core-host-runtime-files";
import type { MemoryCoreAcquireLocalService } from "./memory/embedding-local-service.js";
import {
  DEFAULT_MEMORY_SEARCH_TIMEOUT_MS,
  isMemorySearchDeadlineError,
  runMemorySearchWithDeadline,
} from "./memory/search-deadline.js";
import { getMemoryManagerContextWithPurpose } from "./tools.shared.js";

const TEAM_SEARCH_CONCURRENCY = 4;

export type TeamMemoryHit = {
  agentId: string;
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
};

export type TeamMemorySkip = { agentId: string; reason: "timeout" | "unavailable" };

export type TeamMemorySearchOutcome = {
  results: TeamMemoryHit[];
  skipped: TeamMemorySkip[];
  note?: string;
};

type TeamMemorySearcher = {
  search(
    query: string,
    opts: { maxResults: number; minScore?: number },
  ): Promise<MemorySearchResult[]>;
  status(): { workspaceDir?: string };
  close?(): Promise<void>;
};

export type TeamMemoryLookup = { manager: TeamMemorySearcher } | { error: string | undefined };

type TeamMemorySearchParams = {
  memberIds: readonly string[];
  query: string;
  maxResults: number;
  minScore?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  concurrency?: number;
  closeAfterSearch?: boolean;
  lookupManager: (agentId: string) => Promise<TeamMemoryLookup>;
};

type AgentOutcome =
  | { agentId: string; hits: TeamMemoryHit[] }
  | { agentId: string; reason: TeamMemorySkip["reason"] };

/**
 * Team members are exactly the Trunks the owner lists in agents.teamMemory.agents. Unset means no members.
 * Linked outside Branches (and their grafted Trunks) are never members, even under a builder-* id.
 */
export function resolveTeamMemberIds(cfg: BranchConfig): string[] {
  const listed = cfg.agents?.teamMemory?.agents;
  if (!listed) {
    return [];
  }
  const outside = new Set(listOutsideAgentIdentityIds());
  return listAgentIds(cfg).filter((agentId) => listed.includes(agentId) && !outside.has(agentId));
}

function isUntrusted(result: MemorySearchResult): boolean {
  return result.provenance?.originClass === "untrusted" || result.originClass === "untrusted";
}

/** Only the agent's own workspace notes (MEMORY.md and memory/) are shared. USER.md is never shared. */
function isWorkspaceNotePath(normalized: string): boolean {
  if (path.posix.basename(normalized).toLowerCase() === "user.md") {
    return false;
  }
  return normalized === "MEMORY.md" || normalized.startsWith("memory/");
}

function isLexicallyInside(normalized: string): boolean {
  return (
    !path.posix.isAbsolute(normalized) &&
    !/^[A-Za-z]:/.test(normalized) &&
    normalized !== ".." &&
    !normalized.startsWith("../")
  );
}

/** Resolves symlinks, then checks the real target is still a workspace note inside the workspace. */
async function resolvesToWorkspaceNote(workspaceDir: string, normalized: string): Promise<boolean> {
  try {
    const root = await fs.realpath(workspaceDir);
    const target = await fs.realpath(path.join(root, normalized));
    const relative = path.relative(root, target);
    if (
      relative === "" ||
      path.isAbsolute(relative) ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`)
    ) {
      return false;
    }
    return isWorkspaceNotePath(relative.split(path.sep).join("/"));
  } catch {
    return false;
  }
}

export async function isSharableMemoryPath(
  workspaceDir: string,
  relativePath: string,
): Promise<boolean> {
  const normalized = path.posix.normalize(relativePath.replaceAll("\\", "/"));
  if (!isLexicallyInside(normalized) || !isWorkspaceNotePath(normalized)) {
    return false;
  }
  return resolvesToWorkspaceNote(workspaceDir, normalized);
}

async function shareableHits(
  agentId: string,
  workspaceDir: string,
  found: MemorySearchResult[],
): Promise<TeamMemoryHit[]> {
  const hits: TeamMemoryHit[] = [];
  for (const result of found) {
    if (result.source !== "memory" || isUntrusted(result)) {
      continue;
    }
    if (await isSharableMemoryPath(workspaceDir, result.path)) {
      hits.push({
        agentId,
        path: result.path,
        startLine: result.startLine,
        endLine: result.endLine,
        score: result.score,
        snippet: result.snippet,
      });
    }
  }
  return hits;
}

async function searchMemberNotes(
  params: TeamMemorySearchParams,
  agentId: string,
): Promise<AgentOutcome> {
  const lookup = await params.lookupManager(agentId);
  if ("error" in lookup) {
    return { agentId, reason: "unavailable" };
  }
  const workspaceDir = lookup.manager.status().workspaceDir;
  if (!workspaceDir) {
    return { agentId, reason: "unavailable" };
  }
  try {
    const found = await lookup.manager.search(params.query, {
      maxResults: params.maxResults,
      ...(params.minScore !== undefined ? { minScore: params.minScore } : {}),
    });
    return { agentId, hits: await shareableHits(agentId, workspaceDir, found) };
  } finally {
    if (params.closeAfterSearch) {
      await closeQuietly(lookup.manager);
    }
  }
}

/** A close failure must not replace the search result or the search error. */
async function closeQuietly(manager: TeamMemorySearcher): Promise<void> {
  try {
    await manager.close?.();
  } catch {
    // Ignored on purpose: the search outcome is what the caller needs.
  }
}

async function searchAgent(params: TeamMemorySearchParams, agentId: string): Promise<AgentOutcome> {
  try {
    return await runMemorySearchWithDeadline({
      timeoutMs: params.timeoutMs ?? DEFAULT_MEMORY_SEARCH_TIMEOUT_MS,
      parentSignal: params.signal,
      run: () => searchMemberNotes(params, agentId),
    });
  } catch (error) {
    if (params.signal?.aborted) {
      throw error;
    }
    return { agentId, reason: isMemorySearchDeadlineError(error) ? "timeout" : "unavailable" };
  }
}

async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await run(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function describeSkips(skipped: TeamMemorySkip[]): string | undefined {
  if (skipped.length === 0) {
    return undefined;
  }
  const timedOut = skipped.filter((skip) => skip.reason === "timeout").map((skip) => skip.agentId);
  const unavailable = skipped
    .filter((skip) => skip.reason === "unavailable")
    .map((skip) => skip.agentId);
  const parts = [
    timedOut.length ? `Timed out: ${timedOut.join(", ")}.` : "",
    unavailable.length ? `Unavailable: ${unavailable.join(", ")}.` : "",
  ];
  return `Partial results. ${parts.filter(Boolean).join(" ")}`;
}

export async function searchTeamMemory(
  params: TeamMemorySearchParams,
): Promise<TeamMemorySearchOutcome> {
  params.signal?.throwIfAborted();
  const outcomes = await mapLimited(
    params.memberIds,
    params.concurrency ?? TEAM_SEARCH_CONCURRENCY,
    (agentId) => searchAgent(params, agentId),
  );
  params.signal?.throwIfAborted();
  const results = outcomes
    .flatMap((outcome) => ("hits" in outcome ? outcome.hits : []))
    .toSorted((left, right) => right.score - left.score)
    .slice(0, params.maxResults);
  const skipped = outcomes.flatMap((outcome) =>
    "reason" in outcome ? [{ agentId: outcome.agentId, reason: outcome.reason }] : [],
  );
  const note = describeSkips(skipped);
  return { results, skipped, ...(note ? { note } : {}) };
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
    memberIds: resolveTeamMemberIds(params.cfg),
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
