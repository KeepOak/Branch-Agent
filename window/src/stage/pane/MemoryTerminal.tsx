// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { Block } from "../../thread/model";
import { SIcon } from "../stage-icons";
import { appendTerminal } from "./terminal-text";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const NO_FORGET = "The engine can't forget one memory yet.";

/** Memory: what it remembers that fits this conversation (memory.search with the latest thing you asked). */
export function MemoryTab({ engine, blocks, name }: { engine: WindowEngine; blocks: Block[]; name: string }) {
  const asked = [...blocks].reverse().find((b): b is Extract<Block, { kind: "user" }> => b.kind === "user")?.text.trim().slice(0, 300) ?? "";
  const [state, setState] = useState<{ key: string; rows?: { path: string; snippet: string; startLine?: number }[]; error?: string }>({ key: "" });
  const key = `${engine.sessionKey}|${asked}`;
  useEffect(() => {
    if (!asked) return;
    let live = true;
    engine.request("memory.search", { query: asked, maxResults: 8, ...(engine.agentId ? { agentId: engine.agentId } : {}) }).then(
      (r) => live && setState({ key, rows: (Array.isArray(rec(r).results) ? (rec(r).results as unknown[]) : []).map(rec).map((x) => ({ path: str(x.path), snippet: str(x.snippet), startLine: typeof x.startLine === "number" ? x.startLine : undefined })) }),
      (e: unknown) => live && setState({ key, error: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [engine, asked, key]);
  if (!asked) return <p className="pane-empty">Nothing to look up yet. What {name} remembers about this conversation shows here once you ask something.</p>;
  const cur = state.key === key ? state : { key };
  if (cur.error) return <p className="err-st" role="alert">{cur.error}</p>;
  if (!cur.rows) return <p className="pane-empty">Looking through what {name} remembers…</p>;
  if (!cur.rows.length) return <p className="pane-empty">{name} doesn't remember anything that fits this conversation.</p>;
  return (
    <>
      {cur.rows.map((m, i) => (
        <div key={`${m.path}:${m.startLine}:${i}`} className="memrow-pn">
          <span>{m.snippet.trim()}</span>
          <small>
            {m.path}
            {m.startLine ? ` · line ${m.startLine}` : ""}
          </small>
          <button type="button" className="btn ghost sm" disabled title={NO_FORGET} aria-label={`Forget: ${m.snippet.trim().slice(0, 60)}`}>
            Forget
          </button>
        </div>
      ))}
    </>
  );
}

type Shell = { id: string; label: string; cwd: string; text: string; ended?: string };

/** The live shells this pane opened (terminal.open / input / close), drawn as text. */
function useShells(engine: WindowEngine) {
  const [shells, setShells] = useState<Shell[]>([]);
  const ids = useRef(new Set<string>());
  useEffect(() => {
    const off = engine.onEvent(({ event, payload }) => {
      const p = rec(payload);
      const id = str(p.sessionId);
      if (!ids.current.has(id)) return;
      if (event === "terminal.data" && typeof p.data === "string") setShells((list) => list.map((s) => (s.id === id ? { ...s, text: appendTerminal(s.text, p.data as string) } : s)));
      if (event === "terminal.exit") setShells((list) => list.map((s) => (s.id === id ? { ...s, ended: p.reason === "process_exit" ? "The shell ended." : str(p.error) || "The shell closed." } : s)));
    });
    const open = ids.current;
    return () => {
      off();
      // Shells opened here end with the pane: nothing keeps running unseen.
      for (const id of open) void engine.request("terminal.close", { sessionId: id }).catch(() => undefined);
      open.clear();
    };
  }, [engine]);
  const start = async () => {
    const r = rec(await engine.request("terminal.open", { sessionKey: engine.sessionKey, cols: 100, rows: 30 }));
    const id = str(r.sessionId);
    ids.current.add(id);
    setShells((list) => [...list, { id, label: `shell ${list.length + 1}`, cwd: str(r.cwd), text: "" }]);
    return id;
  };
  const input = (id: string, data: string) => engine.request("terminal.input", { sessionId: id, data });
  const close = (id: string) => {
    ids.current.delete(id);
    setShells((list) => list.filter((s) => s.id !== id));
    return engine.request("terminal.close", { sessionId: id });
  };
  return { shells, start, input, close };
}

const STEP_PILL: Record<string, [string, string]> = { ok: ["ok", "Done"], running: ["work", "Running"], failed: ["bad", "Failed"], denied: ["bad", "You said no"] };

/** Terminal: the commands it ran and what came back, and a live shell of your own in its folder. */
export function TerminalTab({ engine, blocks, name, onError }: { engine: WindowEngine; blocks: Block[]; name: string; onError: (m: string) => void }) {
  const commands = blocks.filter((b): b is Extract<Block, { kind: "step" }> => b.kind === "step" && /(^|[_.])exec$|shell|terminal|process|bash/.test(b.tool));
  const { shells, start, input, close } = useShells(engine);
  const [front, setFront] = useState<string | null>(null);
  const [line, setLine] = useState("");
  const out = useRef<HTMLDivElement>(null);
  const admin = engine.scopes.includes("operator.admin");
  const shell = shells.find((s) => s.id === front) ?? shells.at(-1);
  useEffect(() => {
    if (out.current) out.current.scrollTop = out.current.scrollHeight;
  }, [shell?.text]);
  const open = () => start().then(setFront, (e: unknown) => onError(errorText(e)));
  return (
    <>
      {commands.length ? (
        commands.map((b) => {
          const [tone, word] = STEP_PILL[b.status] ?? ["idle", b.status];
          return (
            <div key={b.key} className="termrow-pn">
              <div className="th2-pn">
                <code>$ {b.detail || b.title}</code>
                <span className={`pill ${tone}`}>{word}</span>
              </div>
              {b.output ? <pre>{b.output}</pre> : null}
            </div>
          );
        })
      ) : (
        <p className="pane-empty">No commands in this conversation yet. Commands {name} runs, and what came back, show here.</p>
      )}
      <div className="acts-br">
        {shells.length ? (
          shell ? (
            <button type="button" className="btn ghost sm" onClick={() => void close(shell.id).catch((e: unknown) => onError(errorText(e)))}>
              Close my terminal
            </button>
          ) : null
        ) : (
          <button type="button" className="btn sm" disabled={!admin || !engine.sessionKey} title={admin ? undefined : "Opening a terminal needs full access to this Branch."} onClick={() => void open()}>
            Open a terminal for me
          </button>
        )}
      </div>
      {shell ? (
        <div className="term-wrap-pn">
          <div className="term-tabs-pn" role="tablist" aria-label="Terminals">
            {shells.map((s) => (
              <span key={s.id} className="term-tab-pn">
                <button type="button" role="tab" aria-selected={s.id === shell.id} title={s.cwd} onClick={() => setFront(s.id)}>
                  {s.label}
                </button>
                <button type="button" className="ib sm" aria-label="Close terminal" title="Close terminal" onClick={() => void close(s.id).catch((e: unknown) => onError(errorText(e)))}>
                  <SIcon name="x" small />
                </button>
              </span>
            ))}
            <button type="button" className="ib sm" aria-label="New terminal" title="New terminal" onClick={() => void open()}>
              <SIcon name="plus" small />
            </button>
          </div>
          <div className="shell-pn">
            <div className="share-pn">
              <button type="button" className="btn ghost sm" disabled title={`The engine can't let ${name} type in a shell you opened yet.`}>
                Let {name} type here
              </button>
              <button type="button" className="btn ghost sm" disabled={Boolean(shell.ended)} onClick={() => void input(shell.id, "\x03").catch((e: unknown) => onError(errorText(e)))}>
                Ctrl C
              </button>
            </div>
            <div className="shell-out-pn" ref={out} aria-live="polite">
              {shell.text}
              {shell.ended ? <div className="term-dim-pn">{shell.ended}</div> : null}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void input(shell.id, `${line}\r`).then(() => setLine(""), (err: unknown) => onError(errorText(err)));
              }}
            >
              <span>{shell.cwd.split(/[\\/]/).filter(Boolean).pop() ?? ""} %</span>
              <input value={line} onChange={(e) => setLine(e.target.value)} autoComplete="off" spellCheck={false} aria-label="Type a command" disabled={Boolean(shell.ended)} />
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
