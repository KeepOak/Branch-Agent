// Reads for the Trunk screens: agents.list, config.get, models.list and node.list, loaded together.
import { useCallback, useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { readModels, type ModelChoice } from "../../composer/model";
import { errorText, readConfig, readRoster, rec, str, type ConfigSnapshot, type Roster } from "./model";

export type Computer = { id: string; name: string; platform: string; connected: boolean };
export type TrunkData = { roster: Roster; snap: ConfigSnapshot; models: ModelChoice[]; computers: Computer[]; partial: string[] };

/** Paired or connected computers from node.list (engine/src/gateway/server-methods/nodes.read.ts). */
export function readComputers(result: unknown): Computer[] {
  const nodes = Array.isArray(rec(result).nodes) ? (rec(result).nodes as unknown[]).map(rec) : [];
  return nodes
    .filter((n) => str(n.nodeId) && (n.paired === true || n.connected === true))
    .map((n) => ({ id: str(n.nodeId), name: str(n.displayName) || str(n.nodeId), platform: str(n.platform), connected: n.connected === true }));
}

export async function loadTrunkData(engine: WindowEngine): Promise<TrunkData> {
  const [roster, config, models, nodes] = await Promise.allSettled([
    engine.request("agents.list", {}),
    engine.request("config.get", {}),
    engine.request("models.list", {}),
    engine.request("node.list", {}),
  ]);
  if (roster.status === "rejected") throw roster.reason;
  if (config.status === "rejected") throw config.reason;
  const partial = [models, nodes].filter((r): r is PromiseRejectedResult => r.status === "rejected").map((r) => errorText(r.reason));
  return {
    roster: readRoster(roster.value),
    snap: readConfig(config.value),
    models: models.status === "fulfilled" ? readModels(models.value).filter((m) => m.available) : [],
    computers: nodes.status === "fulfilled" ? readComputers(nodes.value) : [],
    partial,
  };
}

/** One async read with loading and error, and a reload that keeps what is shown until the new answer arrives. */
export function useLoad<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: true, error: null });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    let current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    load().then(
      (data) => current && setState({ data, loading: false, error: null }),
      (error: unknown) => current && setState((s) => ({ ...s, loading: false, error: errorText(error) })),
    );
    return () => { current = false; };
    // `load` is re-created each render; `key` names what it reads.
  }, [key, revision]);
  return { ...state, reload };
}

/** True when this window may change engine settings (config.patch and agents.* need operator.admin). */
export const canWrite = (engine: WindowEngine) => engine.scopes.includes("operator.admin");
export const WRITE_WHY = "Only the owner of this Branch can change Trunks.";
