// The engine's exec approvals file (exec.approvals.get / exec.approvals.set): the command defaults, each Trunk's
// own policy and the allowed-command rules. Writes queue one at a time against the hash the last read or write
// returned (the engine refuses a stale base hash); a write refused because the file changed reads it again and
// retries once, the way the config store does.
import { useCallback, useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { errorText } from "../adapter";
import { useSaveRunner } from "../kit";

export type Policy = { security?: string; ask?: string; askFallback?: string; autoAllowSkills?: boolean };
export type AllowEntry = { id?: string; pattern: string; source?: string; argPattern?: string; lastUsedAt?: number; commandText?: string; lastUsedCommand?: string; lastResolvedPath?: string };
export type AgentPolicy = Policy & { allowlist?: AllowEntry[]; mcpTools?: unknown[] };
export type ExecFile = { version: 1; socket?: { path?: string }; defaults?: Policy; agents?: Record<string, AgentPolicy> };
export type Resolved = { security: string; ask: string; askFallback: string; autoAllowSkills: boolean };
export type ExecSnapshot = { path: string; exists: boolean; hash: string; file: ExecFile; resolvedDefaults?: Resolved };

/** Engine defaults when the engine leaves out resolvedDefaults (DEFAULT_SECURITY, DEFAULT_ASK, …). */
export const ENGINE_DEFAULTS: Resolved = { security: "full", ask: "off", askFallback: "deny", autoAllowSkills: false };
const CHANGED = /changed since last load|base hash/i;

export type ApprovalsFile = {
  snap: ExecSnapshot | null;
  loading: boolean;
  error?: string;
  resolved: Resolved;
  /** Changes a copy of the file and saves it; resolves false when the save failed. */
  update: (change: (file: ExecFile) => ExecFile) => Promise<boolean>;
};

const copy = (file: ExecFile): ExecFile => JSON.parse(JSON.stringify(file)) as ExecFile;

export function useApprovalsFile(engine: WindowEngine): ApprovalsFile {
  const [snap, setSnap] = useState<ExecSnapshot | null>(null);
  const [state, setState] = useState<{ loading: boolean; error?: string }>({ loading: true });
  const current = useRef<ExecSnapshot | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const run = useSaveRunner();
  const adopt = useCallback((next: ExecSnapshot) => { current.current = next; setSnap(next); }, []);
  const read = useCallback(async () => adopt(await engine.request<ExecSnapshot>("exec.approvals.get", {})), [engine, adopt]);
  useEffect(() => {
    read().then(() => setState({ loading: false }), (e: unknown) => setState({ loading: false, error: errorText(e) }));
  }, [read]);
  const write = useCallback(async (change: (file: ExecFile) => ExecFile) => {
    if (!current.current) await read();
    const once = async () => {
      const base = current.current as ExecSnapshot;
      adopt(await engine.request<ExecSnapshot>("exec.approvals.set", { file: change(copy(base.file)), baseHash: base.hash }));
    };
    try { await once(); } catch (e) {
      if (!CHANGED.test(errorText(e))) throw e;
      await read();
      await once();
    }
  }, [engine, read, adopt]);
  const update = useCallback((change: (file: ExecFile) => ExecFile) => run(() => {
    const next = chain.current.then(() => write(change));
    chain.current = next.catch(() => undefined);
    return next;
  }), [run, write]);
  return { snap, ...state, resolved: snap?.resolvedDefaults ?? ENGINE_DEFAULTS, update };
}

/** The file with one agent's entry changed (the wildcard "*" holds the rules for every Trunk). */
export function withAgent(file: ExecFile, id: string, change: (a: AgentPolicy) => AgentPolicy): ExecFile {
  const agents = { ...(file.agents ?? {}) };
  const next = change({ ...(agents[id] ?? {}) });
  if (Object.keys(next).length) agents[id] = next; else delete agents[id];
  return { ...file, agents };
}

/** The file with one default changed; undefined removes it (back to the engine's default). */
export function withDefault(file: ExecFile, key: keyof Policy, value: string | boolean | undefined): ExecFile {
  const defaults: Policy = { ...(file.defaults ?? {}) };
  if (value === undefined) delete defaults[key]; else (defaults as Record<string, unknown>)[key] = value;
  return { ...file, defaults };
}
