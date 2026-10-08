// The default Trunk beside a place or Settings page (DESIGN-SPEC §3.3, the preview's askPA18 pane): its main
// conversation, docked at the right or the bottom, sending with the page as work context (talk-beside.ts).
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { Pebble } from "../face/Pebble";
import { readLevel } from "../places-nav/SettingsFrame";
import { Markdown } from "../thread/markdown";
import { isPreparationPending, PreparationRetry, preparationLabel, preparationTimeoutLabel } from "../connect/preparation-status";
import { Icon } from "./icons";
import { talkRows, workContextFor, type TalkRow, type WorkContext } from "./talk-beside";
import "./talk-beside.css";

export type TalkDock = "right" | "bottom";
type Layout = { open: boolean; dock: TalkDock; w: number; h: number };
const KEY = "branch.talkBeside";
const START: Layout = { open: false, dock: "right", w: 380, h: 320 };
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const reason = (e: unknown) => (e instanceof Error ? e.message : String(e));

function readLayout(): Layout {
  try {
    const v = rec(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
    const num = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
    return { open: v.open === true, dock: v.dock === "bottom" ? "bottom" : "right", w: num(v.w, START.w), h: num(v.h, START.h) };
  } catch {
    return START; // storage blocked or unreadable: closed, at the right
  }
}

/** Whether the pane is open, where it is docked and its size; kept on this computer like the preview's. */
export function useTalkLayout(): [Layout, (patch: Partial<Layout>) => void] {
  const [layout, setLayout] = useState<Layout>(readLayout);
  const change = useCallback((patch: Partial<Layout>) => {
    setLayout((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // storage blocked: the choice lasts for this window only
      }
      return next;
    });
  }, []);
  return [layout, change];
}

type Request = <T = unknown>(method: string, params?: unknown) => Promise<T>;
type OnEvent = (listener: (event: string, payload: unknown) => void) => () => void;

/** The main conversation's messages, whether the Trunk is answering, and sending. Only the newest read is kept; a run
 *  counts as answering from chat.send (or history's in-flight run) until the engine's chat event says it ended. */
export function useTalkThread(request: Request, onEvent: OnEvent, key: string | null, name = "") {
  const [rows, setRows] = useState<TalkRow[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const retry = useRef(new PreparationRetry());
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reads = useRef(0);
  const ended = useRef(new Set<string>());
  const adopt = (id: string) => {
    if (id && !ended.current.has(id)) setRunId(id);
  };
  const load = useCallback(async () => {
    if (!key) return;
    if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    const n = ++reads.current;
    try {
      const h = rec(await request("chat.history", { sessionKey: key, limit: 60 }));
      if (n !== reads.current) return;
      retry.current.reset();
      setError(null);
      setNotice(null);
      setRows(talkRows(Array.isArray(h.messages) ? h.messages : [], key));
      const live = str(rec(h.inFlightRun).runId);
      if (live && !ended.current.has(live)) setRunId(live);
    } catch (e) {
      if (n !== reads.current) return;
      if (isPreparationPending(e)) {
        const delay = retry.current.nextDelay();
        setError(null);
        setNotice(delay === null ? preparationTimeoutLabel(name) : preparationLabel(name));
        if (delay !== null) retryTimer.current = setTimeout(() => void load(), delay);
      } else {
        setNotice(null);
        setError(reason(e));
      }
    }
  }, [request, key, name]);
  useEffect(() => {
    retry.current.reset();
    setError(null);
    setNotice(null);
    void load();
    return () => {
      ++reads.current;
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
      retryTimer.current = null;
    };
  }, [load]);
  useEffect(() => onEvent((event, payload) => {
    const p = rec(payload);
    if (str(p.sessionKey) !== key) return;
    if (event === "sessions.changed" || event === "session.message") {
      void load();
      return;
    }
    if (event !== "chat" || !["final", "error", "aborted"].includes(str(p.state))) return;
    ended.current.add(str(p.runId));
    setRunId(null);
    void load();
  }), [onEvent, key, load]);
  const send = async (message: string, workContext: WorkContext | undefined): Promise<boolean> => {
    if (!key) return false;
    setError(null);
    setSending(true);
    try {
      adopt(str(rec(await request("chat.send", { sessionKey: key, message, idempotencyKey: crypto.randomUUID(), ...(workContext ? { workContext } : {}) })).runId));
      await load();
      return true;
    } catch (e) {
      setError(reason(e));
      return false;
    } finally {
      setSending(false);
    }
  };
  return { rows, running: sending || runId !== null, error, notice, send };
}

/** Whether text is selected on the page (not in the pane), so "Attach selected text" can be offered. */
function useSelectionOffer(pane: RefObject<HTMLElement | null>): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    const check = () => {
      const sel = window.getSelection();
      const inPane = sel?.anchorNode ? pane.current?.contains(sel.anchorNode) : false;
      setHas(Boolean(sel?.toString().trim()) && !inPane);
    };
    document.addEventListener("selectionchange", check);
    return () => document.removeEventListener("selectionchange", check);
  }, [pane]);
  return has;
}

function YouRow({ row }: { row: Extract<TalkRow, { kind: "you" }> }) {
  return (
    <div className="talk-you">
      <p>{row.text}</p>
      {row.context ? (
        <details className="talk-ctx">
          <summary>Context attached</summary>
          <dl>{row.context.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          {readLevel() === "technical" ? <pre>{JSON.stringify(Object.fromEntries(row.context), null, 1)}</pre> : null}
        </details>
      ) : null}
    </div>
  );
}

export function TalkThread({ rows, name, running, pending }: { rows: TalkRow[]; name: string; running: boolean; pending: string | null }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" }); // scrollIntoView can return a Promise; an effect must return nothing
  }, [rows, running, pending]);
  return (
    <div className="talk-body" data-testid="talk-thread">
      {rows.map((r) => r.kind === "you" ? <YouRow key={r.key} row={r} /> : (
        <div key={r.key} className="talk-trunk"><Pebble size={20} label={name} /><div><Markdown text={r.text} /></div></div>
      ))}
      {pending ? <div className="talk-you"><p>{pending}</p></div> : null}
      {running ? <div className="talk-trunk"><Pebble size={20} label={name} state="work" /><div className="talk-typing" aria-label={`${name} is answering`}><i /><i /><i /></div></div> : null}
      <div ref={end} />
    </div>
  );
}

type Props = { request: Request; onEvent: OnEvent; sessionKey: string | null; name: string; page: string; layout: Layout; onLayout: (patch: Partial<Layout>) => void; onFull: () => void };

/** The pane. Closing it hands focus back to the footer button when that is on screen. */
export function TalkBeside({ request, onEvent, sessionKey, name, page, layout, onLayout, onFull }: Props) {
  const pane = useRef<HTMLElement>(null);
  const thread = useTalkThread(request, onEvent, sessionKey, name);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [withPage, setWithPage] = useState(true);
  const [selection, setSelection] = useState("");
  const canAttach = useSelectionOffer(pane);
  const right = layout.dock === "right";
  const close = () => {
    onLayout({ open: false });
    document.querySelector<HTMLElement>("[data-testid=talk-beside-button]")?.focus();
  };
  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setPending(text);
    setDraft("");
    const ok = await thread.send(text, withPage ? workContextFor(page, selection) : undefined);
    setPending(null);
    if (ok) setSelection("");
    else setDraft(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };
  return (
    <aside ref={pane} className={right ? "talk" : "talk at-bottom"} aria-label={`Talk to ${name}`} data-testid="talk-beside" style={right ? { ["--talk-w" as string]: `${layout.w}px` } : { ["--talk-h" as string]: `${layout.h}px` }}>
      <Resizer layout={layout} onLayout={onLayout} />
      <div className="talk-head">
        <Pebble size={24} label={name} />
        <b>{name}</b>
        <span className="grow" />
        <button type="button" className="ib sm" aria-label="Open it full size" title="Open it full size" onClick={onFull}><Icon name="external" small /></button>
        <button type="button" className="ib sm" aria-label={right ? "Dock at the bottom" : "Dock at the right"} title={right ? "Dock at the bottom" : "Dock at the right"} onClick={() => onLayout({ dock: right ? "bottom" : "right" })}><Icon name="panel" small /></button>
        <button type="button" className="ib sm" aria-label="Close" title="Close" onClick={close}><Icon name="x" small /></button>
      </div>
      <TalkThread rows={thread.rows} name={name} running={thread.running} pending={pending} />
      <div className="talk-foot">
        <div className="talk-chips">
          {withPage ? (
            <span className="talk-chip">Working on: {page}<button type="button" aria-label="Remove work context" title="Remove work context" onClick={() => setWithPage(false)}><Icon name="x" size={11} /></button></span>
          ) : <button type="button" className="link" onClick={() => setWithPage(true)}>Include work context</button>}
          {selection ? (
            <span className="talk-chip">“{selection.slice(0, 40)}{selection.length > 40 ? "…" : ""}”<button type="button" aria-label="Remove selected text" title="Remove selected text" onClick={() => setSelection("")}><Icon name="x" size={11} /></button></span>
          ) : canAttach ? <button type="button" className="link" onClick={() => setSelection((window.getSelection()?.toString() ?? "").trim().slice(0, 4000))}>Attach selected text</button> : null}
        </div>
        {thread.error ? <p className="talk-error" role="alert">{thread.error}</p> : null}
        {thread.notice ? <p role="status" style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>{thread.notice}</p> : null}
        <div className="talk-input">
          <textarea rows={2} autoFocus value={draft} placeholder={`Message ${name}`} aria-label={`Message ${name}`} disabled={!sessionKey} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
          <button type="button" className="btn pri sm" disabled={!sessionKey || !draft.trim()} onClick={() => void send()}>Send</button>
        </div>
      </div>
    </aside>
  );
}

/** The pane's edge: drag to resize, double-click for the usual size (the preview's resizer). */
function Resizer({ layout, onLayout }: { layout: Layout; onLayout: (patch: Partial<Layout>) => void }) {
  const right = layout.dock === "right";
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const x0 = e.clientX;
    const y0 = e.clientY;
    const { w, h } = layout;
    const move = (ev: globalThis.PointerEvent) =>
      onLayout(right ? { w: Math.round(Math.max(300, Math.min(innerWidth * 0.6, w - (ev.clientX - x0)))) } : { h: Math.round(Math.max(200, Math.min(innerHeight * 0.7, h - (ev.clientY - y0)))) });
    const up = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", up);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", up);
  };
  return <div className="talk-rz" title="Drag to resize · double-click to reset" style={{ cursor: right ? "col-resize" : "row-resize" }} onPointerDown={down} onDoubleClick={() => onLayout({ w: START.w, h: START.h })} />;
}
