import { performance } from "node:perf_hooks";
import { setImmediate as yieldToEventLoop } from "node:timers/promises";
import { resolveSessionStorePathCore } from "../config/sessions/paths.js";
import { withSessionStoreReaderInWorker } from "../config/sessions/session-entry-read-runtime.js";
import type { SessionHistoryWorkerDatabase } from "../config/sessions/session-transcript-worker.types.js";
import { captureSessionTranscriptStorageEnvironment } from "../config/sessions/transcript-target-binding.js";
import type { BranchConfig } from "../config/types.js";
import type { listGatewayAgentsBasic } from "../gateway/agent-list.js";
import type { SessionRowProjection } from "../gateway/session-row-projection.js";
import { readAgentDatabaseAdmissionRefusal } from "../state/agent-database-admission.js";
import { runTasksWithConcurrency } from "../utils/run-with-concurrency.js";

export const STATUS_RECENT_SESSION_LIMIT = 10;
/** Upper bound on concurrent per-agent session store reads during `status`. */
export const STATUS_SESSION_STORE_READ_CONCURRENCY = 4;
const SESSION_STORE_READ_SLICE_MS = 8;
type SessionStoreSummary = Awaited<ReturnType<SessionHistoryWorkerDatabase["readStoreSummary"]>>;
export type StatusSessionStores = Awaited<
  ReturnType<
    typeof readStatusSessionStores<
      Awaited<ReturnType<typeof listGatewayAgentsBasic>>["agents"][number]
    >
  >
>;

function summarizeProjectionRows(
  projection: SessionRowProjection,
  storePath: string,
  agentIds: readonly string[],
  recentLimit: number,
): SessionStoreSummary {
  const rows = projection.selectEntries({ storePath, sortBy: null });
  if (recentLimit !== 0) {
    // The projection returns a fresh selection, independent of its resident indexes.
    rows.sort(
      (left, right) =>
        (right.entry.updatedAt ?? 0) - (left.entry.updatedAt ?? 0) ||
        (left.key < right.key ? -1 : left.key > right.key ? 1 : 0),
    );
  }
  const summarize = (selected: typeof rows) => ({
    count: selected.length,
    recent: selected.slice(0, recentLimit).map(({ key: sessionKey, entry }) => ({
      sessionKey,
      entry,
    })),
  });
  if (recentLimit >= 0) {
    const byAgent: SessionStoreSummary["byAgent"] = new Map(
      agentIds.map((agentId) => [agentId, { count: 0, recent: [] }]),
    );
    rows.forEach((row) => {
      const agent = byAgent.get(row.agentId);
      if (agent) {
        agent.count += 1;
        if (agent.count <= recentLimit) {
          agent.recent.push({ sessionKey: row.key, entry: row.entry });
        }
      }
    });
    return { count: rows.length, recent: recentLimit === 0 ? [] : summarize(rows).recent, byAgent };
  }
  return {
    ...summarize(rows),
    byAgent: new Map(
      agentIds.map((agentId) => [
        agentId,
        summarize(rows.filter((row) => row.agentId === agentId)),
      ]),
    ),
  };
}

/** One collection owns each physical store's bounded snapshot, including its agent windows. */
export function createStatusSessionStoreReader(
  agentIds: readonly string[],
  recentLimit: number,
  options: {
    projection?: SessionRowProjection;
    recoverReadError?: (error: unknown) => SessionStoreSummary;
  } = {},
) {
  const env = captureSessionTranscriptStorageEnvironment(process.env);
  const stores = new Map<string, SessionStoreSummary & { path: string }>();
  let sliceStartedAt = performance.now();
  return {
    stores,
    read(storePath: string, agentId?: string) {
      return withSessionStoreReaderInWorker(
        { storePath, agentId, env },
        async ({ reader, database, selectedStore, continuation, assertCurrent }) => {
          const path = selectedStore.path;
          if (agentId && readAgentDatabaseAdmissionRefusal(agentId, { env })) {
            return { path, count: 0, recent: [] };
          }
          let store = stores.get(database.path);
          if (!store) {
            let summary: SessionStoreSummary;
            try {
              const projection = options.projection;
              if (projection) {
                do {
                  await projection.ensureMaterialized();
                  assertCurrent();
                } while (projection.needsMaterialization);
              }
              summary = projection
                ? summarizeProjectionRows(projection, database.path, agentIds, recentLimit)
                : await reader.readStoreSummary({
                    env: database.env,
                    agentIds,
                    recentLimit,
                    continuation,
                  });
            } catch (error) {
              if (!options.recoverReadError) {
                throw error;
              }
              summary = options.recoverReadError(error);
            }
            // Worker reads already yield; resident selections share an event-loop slice.
            if (
              options.projection &&
              performance.now() - sliceStartedAt >= SESSION_STORE_READ_SLICE_MS
            ) {
              await yieldToEventLoop();
              sliceStartedAt = performance.now();
            }
            assertCurrent();
            if (agentId && readAgentDatabaseAdmissionRefusal(agentId, { env })) {
              return { path, count: 0, recent: [] };
            }
            store = { ...summary, path };
            stores.set(database.path, store);
          }
          const summary = agentId ? store.byAgent.get(agentId) : store;
          return { path, count: summary?.count ?? 0, recent: summary?.recent ?? [] };
        },
        { backing: !options.projection, dataOnly: true, logical: {} },
      );
    },
  };
}

/** Reads each physical store once, retaining retired agent namespaces in the aggregate. */
export async function readStatusSessionStores<Agent extends { id: string; name?: string }>(
  cfg: BranchConfig,
  agents: readonly Agent[],
  recentLimit: number,
  projection?: SessionRowProjection,
) {
  const reader = createStatusSessionStoreReader(
    agents.map((agent) => agent.id),
    recentLimit,
    { projection },
  );
  // Each read opens a worker-backed store; reading agents one at a time made status
  // scale linearly with agent count (~40 s for 16 agents). Distinct store paths are read
  // with bounded fan-out; agents sharing one path stay serial so it is read only once.
  const groups = new Map<string, Agent[]>();
  for (const agent of agents) {
    const storePath = resolveSessionStorePathCore(cfg.session?.store, { agentId: agent.id });
    groups.set(storePath, [...(groups.get(storePath) ?? []), agent]);
  }
  const results = new Map<Agent, Awaited<ReturnType<typeof reader.read>>>();
  await runTasksWithConcurrency({
    limit: STATUS_SESSION_STORE_READ_CONCURRENCY,
    throwOnError: true,
    tasks: [...groups].map(([storePath, group]) => async () => {
      for (const agent of group) {
        results.set(agent, await reader.read(storePath, agent.id));
      }
    }),
  });
  const byAgent = agents.map((agent) => ({ agent, ...results.get(agent)! }));
  return {
    paths: [...reader.stores.values()].map((store) => store.path),
    count: [...reader.stores.values()].reduce((count, store) => count + store.count, 0),
    recent: [...reader.stores.values()].flatMap((store) => store.recent),
    byAgent,
  };
}
