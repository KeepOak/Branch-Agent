import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { appendTerminal } from "./terminal-text";

type Shell = { id: string; label: string; cwd: string; text: string; ended?: string };
type Owner = { engine: WindowEngine; sessionKey: string | null; live: boolean; ids: Set<string> };
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === "string" ? v : "";
const retire = (owner: Owner) => {
  owner.live = false;
  for (const id of owner.ids) void owner.engine.request("terminal.close", { sessionId: id }).catch(() => undefined);
  owner.ids.clear();
};
function updateShell(shell: Shell, id: string, event: string, p: Record<string, unknown>): Shell {
  if (shell.id !== id) return shell;
  if (event === "terminal.data" && typeof p.data === "string") return { ...shell, text: appendTerminal(shell.text, p.data) };
  if (event === "terminal.exit") return { ...shell, ended: p.reason === "process_exit" ? "The shell ended." : text(p.error) || "The shell closed." };
  return shell;
}

/** Only terminals opened by this conversation belong to this pane. */
export function useShells(engine: WindowEngine) {
  const owner = useRef<Owner>({ engine, sessionKey: engine.sessionKey, live: false, ids: new Set() });
  const [state, setState] = useState<{ owner: Owner; shells: Shell[] }>({ owner: owner.current, shells: [] });
  useEffect(() => {
    const current: Owner = { engine, sessionKey: engine.sessionKey, live: true, ids: new Set() };
    owner.current = current;
    setState({ owner: current, shells: [] });
    const off = engine.onEvent(({ event, payload }) => {
      const p = record(payload), id = text(p.sessionId);
      if (!current.live || !current.ids.has(id)) return;
      setState((s) => ({ ...s, shells: s.shells.map((shell) => updateShell(shell, id, event, p)) }));
    });
    return () => { off(); retire(current); };
  }, [engine, engine.sessionKey]);
  const start = async () => {
    const current = owner.current;
    const r = record(await engine.request("terminal.open", { sessionKey: current.sessionKey, cols: 100, rows: 30 }));
    const id = text(r.sessionId);
    if (!id) throw new Error("The engine didn't return a terminal session.");
    if (!current.live) {
      await engine.request("terminal.close", { sessionId: id });
      return null;
    }
    current.ids.add(id);
    setState((s) => ({ owner: current, shells: [...s.shells, { id, label: `shell ${s.shells.length + 1}`, cwd: text(r.cwd), text: "" }] }));
    return id;
  };
  const input = (id: string, data: string) => engine.request("terminal.input", { sessionId: id, data });
  const close = async (id: string) => {
    const current = owner.current;
    await engine.request("terminal.close", { sessionId: id });
    current.ids.delete(id);
    if (current.live) setState((s) => ({ ...s, shells: s.shells.filter((shell) => shell.id !== id) }));
  };
  const shells = state.owner.engine === engine && state.owner.sessionKey === engine.sessionKey ? state.shells : [];
  return { shells, start, input, close };
}
