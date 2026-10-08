// Engine reads for Automations. Optional reads (Trunks, runs) never hide the schedules when they fail.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { WindowEngine } from "../../connect/engine";
import type { Trunk } from "./Proposal";
import { paged, rec, rows, str, type Row } from "./runtime";

export type Scheduled = { jobs: Row[]; status: Row; trunks: Trunk[]; defaultId: string; runs: Map<string, JobRuns> };

export async function loadTrunks(engine: WindowEngine): Promise<{ trunks: Trunk[]; defaultId: string }> {
  const r = rec(await engine.request("agents.list", {}));
  const trunks = rows(r.agents).filter(a => a.hidden !== true).map(a => ({ id: str(a.id), name: str(rec(a.identity).name) || str(a.name) || str(a.id) })).filter(t => t.id);
  return { trunks, defaultId: str(r.defaultId) || trunks[0]?.id || "" };
}

export type JobRuns = { entries: Row[]; total: number };
/** Each automation's newest runs (cron.runs scope job, newest first), one bounded request per automation. */
export async function loadRecentRuns(engine: WindowEngine, jobs: Row[]): Promise<Map<string, JobRuns>> {
  const ids = jobs.map(j => str(j.id)).filter(Boolean);
  const pages = await Promise.allSettled(ids.map(id => engine.request("cron.runs", { scope: "job", id, sortDir: "desc", limit: 50 })));
  const map = new Map<string, JobRuns>();
  pages.forEach((p, i) => {
    if (p.status !== "fulfilled") return;
    const r = rec(p.value), entries = rows(r.entries);
    map.set(ids[i], { entries, total: typeof r.total === "number" ? r.total : entries.length });
  });
  return map;
}

export async function loadScheduled(engine: WindowEngine): Promise<Scheduled> {
  const [jobs, status, trunks] = await Promise.allSettled([
    paged(engine, "cron.list", "jobs", { includeDisabled: true }),
    engine.request("cron.status", {}),
    loadTrunks(engine),
  ]);
  if (jobs.status === "rejected") throw jobs.reason;
  const runs = await loadRecentRuns(engine, jobs.value);
  const t = trunks.status === "fulfilled" ? trunks.value : { trunks: [], defaultId: engine.agentId ?? "" };
  return { jobs: jobs.value, status: status.status === "fulfilled" ? rec(status.value) : {}, ...t, runs };
}

export async function loadModels(engine: WindowEngine): Promise<string[]> {
  const r = rec(await engine.request("models.list", {}));
  return rows(r.models).map(m => (str(m.provider) ? `${str(m.provider)}/${str(m.id)}` : str(m.id))).filter(Boolean);
}

/** config.patch on one section with the revision just read (the engine hot-reloads cron.*; others may restart it). */
export async function patchConfig(engine: WindowEngine, patch: Row): Promise<Row> {
  const snapshot = rec(await engine.request("config.get", {}));
  if (!str(snapshot.hash)) throw new Error("The engine did not provide a configuration revision. Refresh and try again.");
  const result = rec(await engine.request("config.patch", { baseHash: str(snapshot.hash), raw: JSON.stringify(patch) }));
  if (result.ok !== true) throw new Error(str(result.error) || "The engine did not confirm the change was saved.");
  return result;
}
