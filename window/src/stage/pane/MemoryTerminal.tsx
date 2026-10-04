import { useEffect, useRef, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { Block } from "../../thread/model";
import { SIcon } from "../stage-icons";
import { useShells } from "./use-shells";

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const NO_FORGET = "The engine can't forget one memory yet.";

/** Memory: what it remembers that fits this conversation (memory.search with the latest thing you asked). */
export function MemoryTab({ engine, blocks, name }: { engine: WindowEngine; blocks: Block[]; name: string }) {
  const asked = [...blocks].reverse().find((b): b is Extract<Block, { kind: "user" }> => b.kind === "user")?.text.trim().slice(0, 300) ?? "";
  const [state, setState] = useState<{ owner: WindowEngine; key: string; rows?: { path: string; snippet: string; startLine?: number }[]; error?: string }>({ owner: engine, key: "" });
  const [attempt, setAttempt] = useState(0);
  const key = `${engine.sessionKey}|${asked}`;
  useEffect(() => {
    if (!asked) return;
    let live = true;
    engine.request("memory.search", { query: asked, maxResults: 8, ...(engine.agentId ? { agentId: engine.agentId } : {}) }).then(
      (r) => live && setState({ owner: engine, key, rows: (Array.isArray(rec(r).results) ? (rec(r).results as unknown[]) : []).map(rec).map((x) => ({ path: str(x.path), snippet: str(x.snippet), startLine: typeof x.startLine === "number" ? x.startLine : undefined })) }),
      (e: unknown) => live && setState({ owner: engine, key, error: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [engine, asked, key, attempt]);
  if (!asked) return <p className="pane-empty">Nothing to look up yet. What {name} remembers about this conversation shows here once you ask something.</p>;
  const cur = state.owner === engine && state.key === key ? state : { key };
  if (cur.error) return <div><p className="err-st" role="alert">{cur.error}</p><button type="button" className="btn sm" onClick={() => { setState({ owner: engine, key }); setAttempt((value) => value + 1); }}>Try again</button></div>;
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

const STEP_PILL: Record<string, [string, string]> = { ok: ["ok", "Done"], running: ["work", "Running"], failed: ["bad", "Failed"], denied: ["bad", "You said no"] };

function TerminalInput({ engine, id, cwd, ended, input, onError }: { engine: WindowEngine; id: string; cwd: string; ended?: string; input: (id: string, data: string) => Promise<unknown>; onError: (message: string) => void }) {
  const [line, setLine] = useState("");
  const draft = useRef(line);
  const owner = useRef({ live: false });
  draft.current = line;
  useEffect(() => { const current = { live: true }; owner.current = current; setLine(""); return () => { current.live = false; }; }, [engine]);
  return <form onSubmit={(e) => {
    e.preventDefault();
    const sent = line;
    const current = owner.current;
    void input(id, `${sent}\r`).then(
      () => { if (current.live && draft.current === sent) setLine(""); },
      (error: unknown) => { if (current.live) onError(errorText(error)); },
    );
  }}>
    <span>{cwd.split(/[\\/]/).filter(Boolean).pop() ?? ""} %</span>
    <input value={line} onChange={(e) => setLine(e.target.value)} autoComplete="off" spellCheck={false} aria-label="Type a command" disabled={Boolean(ended)} />
  </form>;
}

/** Terminal: the commands it ran and what came back, and a live shell of your own in its folder. */
export function TerminalTab({ engine, blocks, name, onError }: { engine: WindowEngine; blocks: Block[]; name: string; onError: (m: string) => void }) {
  const commands = blocks.filter((b): b is Extract<Block, { kind: "step" }> => b.kind === "step" && /(^|[_.])exec$|shell|terminal|process|bash/.test(b.tool));
  const { shells, start, input, close } = useShells(engine);
  const [front, setFront] = useState<string | null>(null);
  const out = useRef<HTMLDivElement>(null);
  const admin = engine.scopes.includes("operator.admin");
  const shell = shells.find((s) => s.id === front) ?? shells.at(-1);
  useEffect(() => {
    if (out.current) out.current.scrollTop = out.current.scrollHeight;
  }, [shell?.text]);
  const open = () => start().then((id) => { if (id !== null) setFront(id); }, (e: unknown) => onError(errorText(e)));
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
            <TerminalInput key={`${engine.sessionKey}:${shell.id}`} engine={engine} id={shell.id} cwd={shell.cwd} ended={shell.ended} input={input} onError={onError} />
          </div>
        </div>
      ) : null}
    </>
  );
}
