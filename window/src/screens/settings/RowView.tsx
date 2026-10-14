// One renderer for every Settings row: the label (with an inline Advanced / Technical tag), its help, the control the
// table names, and the row's state from useRow. A Coming row keeps its control visible but disabled, with the one-line
// reason, and is listed by data-coming with the call it waits for (R1-10). Rules lines never separate rows. The control
// goes through <Coming> with the calls the row makes (useRow callsOf), so an engine without config.patch or
// users.prefs.set shows Coming instead of a live control; a row that stays on this computer says data-local.
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Coming } from "../../glass/coming";
import type { Level } from "./nav";
import type { Row, RowOption } from "./rows";
import { CHANGED_ELSEWHERE, LOAD_FAILED, NO_PERSON, useRow } from "./useRow";

export const RESTART_NOTE = "Takes effect after a restart.";
const TAG: Record<Level, string | undefined> = { 0: undefined, 1: "Advanced", 2: "Technical" };

/** Where each segmented control's thumb last was, by its label, so a re-created control starts there and springs on. */
const lastThumb = new Map<string, { x: number; w: number }>();

export function Segmented({ label, value, options, disabled, onChange }: { label: string; value: unknown; options: RowOption[]; disabled?: boolean; onChange: (v: RowOption["v"]) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLElement>(null);
  const index = options.findIndex((o) => o.v === value);
  useLayoutEffect(() => {
    const el = thumb.current;
    const on = box.current?.querySelectorAll<HTMLButtonElement>("button")[index];
    if (!el) return;
    if (!on) { el.style.width = "0px"; return; }
    const next = { x: on.offsetLeft, w: on.offsetWidth };
    const prev = lastThumb.get(label);
    if (prev && (prev.x !== next.x || prev.w !== next.w) && !el.dataset.placed) {
      el.style.transition = "none";
      el.style.transform = `translateX(${prev.x}px)`;
      el.style.width = `${prev.w}px`;
      void el.offsetWidth;
      el.style.transition = "";
    }
    el.dataset.placed = "1";
    el.style.transform = `translateX(${next.x}px)`;
    el.style.width = `${next.w}px`;
    lastThumb.set(label, next);
  });
  const move = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || disabled) return;
    e.preventDefault();
    const next = options[(Math.max(index, 0) + step + options.length) % options.length];
    onChange(next.v);
    requestAnimationFrame(() => box.current?.querySelectorAll<HTMLButtonElement>("button")[options.indexOf(next)]?.focus());
  };
  return (
    <div ref={box} className="r1s-seg g-frost" role="radiogroup" aria-label={label} onKeyDown={move}>
      <i ref={thumb} aria-hidden="true" />
      {options.map((o, i) => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={i === index} tabIndex={i === Math.max(index, 0) ? 0 : -1} disabled={disabled} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Toggle({ label, on, disabled, onChange }: { label: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" className="r1s-sw" role="switch" aria-label={label} aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} />;
}

/** A field that saves when it is left or Enter is pressed, and only when the text changed. */
function Field({ label, value, kind, unit, disabled, placeholder, onSave }: { label: string; value: unknown; kind: "number" | "text" | "secret"; unit?: string; disabled?: boolean; placeholder?: string; onSave: (v: unknown) => void }) {
  const shown = value === undefined || value === null ? "" : String(value);
  const [text, setText] = useState(shown);
  const [base, setBase] = useState(shown);
  if (shown !== base) { setBase(shown); setText(shown); }
  const commit = () => {
    if (text === shown) return;
    if (kind !== "number") return onSave(text === "" ? null : text);
    const n = Number(text);
    if (text.trim() === "") onSave(null); else if (Number.isFinite(n)) onSave(n); else setText(shown);
  };
  return (
    <>
      <input className="r1s-inp" aria-label={label} type={kind === "secret" ? "password" : kind === "number" ? "number" : "text"} value={text} disabled={disabled} placeholder={placeholder}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
      {unit ? <span className="r1s-unit g-label">{unit}</span> : null}
    </>
  );
}

export function RowView({ engine, row }: { engine: WindowEngine; row: Row }) {
  const r = useRow(engine, row);
  const coming = r.state === "coming";
  // Disabled while there is nothing to change: Coming, still loading, a change this connection or the settings file
  // can't take, or the settings (or the person) didn't load.
  const off = coming || r.state === "loading" || r.state === "blocked" || (r.state === "error" && (r.reason === LOAD_FAILED || r.reason === NO_PERSON));
  const save = (v: unknown) => { void r.set(v).catch(() => undefined); };
  const options = row.options ?? [];
  const control = (() => {
    switch (row.control) {
      case "toggle": return <Toggle label={r.label} on={r.value === true} disabled={off} onChange={save} />;
      case "segmented": return <Segmented label={r.label} value={r.value} options={options} disabled={off} onChange={save} />;
      case "select": return (
        <select className="r1s-inp" aria-label={r.label} value={String(r.value ?? "")} disabled={off} onChange={(e) => save(options.find((o) => String(o.v) === e.target.value)?.v ?? e.target.value)}>
          {options.map((o) => <option key={String(o.v)} value={String(o.v)}>{o.label}</option>)}
        </select>
      );
      case "number": case "text": return <Field label={r.label} value={r.value} kind={row.control} unit={row.unit} disabled={off} onSave={save} />;
      case "secret": return <Field label={r.label} value={r.sensitive ? "" : r.value} kind="secret" disabled={off} placeholder={r.value ? "Saved" : undefined} onSave={save} />;
      default: return null;
    }
  })();
  const tag = TAG[r.level];
  const stack = row.control === "segmented" && options.length > 3;
  return (
    <div id={`row-${row.id}`} className={`r1s-row${stack ? " r1s-stack" : ""}`} data-row={row.id} data-lv={tag} aria-disabled={coming || undefined}
      aria-busy={r.state === "saving" || undefined} data-coming={coming ? r.need : undefined} title={coming ? r.reason : undefined}>
      <b className="g-label" data-lv={tag}>{r.label}</b>
      {r.help ? <small className="g-label" data-lines>{r.help}</small> : null}
      {coming || r.calls.length
        ? <Coming engine={engine} need={r.calls} unwired={coming} reason={coming ? r.reason : undefined} where={r.label}><div className="r1s-ctl">{control}</div></Coming>
        : <div className="r1s-ctl" data-local="">{control}</div>}
      {coming || r.state === "blocked" ? <small className="r1s-note g-label" data-lines>{r.reason}</small>
        : r.state === "error" && r.reason ? (
          <small className="r1s-note r1s-bad g-label" data-lines role="status">
            {r.reason === CHANGED_ELSEWHERE ? <>Changed somewhere else · <Coming engine={engine} need="config.get"><button type="button" className="r1s-link" onClick={() => void r.retry()}>Reload</button></Coming></>
              // A config load failure has the page's own Try again; a pref load failure is retried here.
              : r.reason === LOAD_FAILED && row.source.kind !== "config" ? <>Settings didn’t load · {row.source.kind === "pref" || row.source.kind === "look"
                ? <Coming engine={engine} need="users.prefs.get"><button type="button" className="r1s-link" onClick={() => void r.retry()}>Try again</button></Coming>
                : <button type="button" className="r1s-link" data-local="" onClick={() => void r.retry()}>Try again</button>}</>
              : r.reason}
          </small>
        ) : r.restart ? <small className="r1s-note g-label">{RESTART_NOTE}</small> : null}
    </div>
  );
}
