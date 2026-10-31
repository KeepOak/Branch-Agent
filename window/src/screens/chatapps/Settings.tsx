import type { WindowEngine } from "../../connect/engine";
import { useRow, type Row } from "../settings";

export function ChatAppRow({ engine, row }: { engine: WindowEngine; row: Row }) {
  const view = useRow(engine, row);
  const disabled = view.state !== "ready";
  return <div className="r1-ca-setting"><span className="g-label" data-lines><b>{view.label}</b>{view.help && <small>{view.help}</small>}</span>
    {view.state === "coming" ? <span className="g-label" data-coming={view.reason} title={view.reason}>Coming · {view.reason}</span> : row.control === "select" ? <select aria-label={view.label} disabled={disabled} value={String(view.value ?? "")} data-need="config.patch" onChange={e => { const option = row.options?.find(o => String(o.v) === e.target.value); if (option) void view.set(option.v).catch(() => undefined); }}><option value="" disabled>Use default</option>{row.options?.map(o => <option key={String(o.v)} value={String(o.v)}>{o.label}</option>)}</select>
      : row.control === "toggle" ? <input type="checkbox" aria-label={view.label} checked={view.value === true} disabled={disabled} data-need="config.patch" onChange={e => void view.set(e.target.checked).catch(() => undefined)} />
        : <input type="number" aria-label={view.label} defaultValue={typeof view.value === "number" ? view.value : ""} key={String(view.value)} disabled={disabled} data-need="config.patch" onBlur={e => { if (e.target.value && Number.isFinite(e.target.valueAsNumber) && e.target.valueAsNumber !== view.value) void view.set(e.target.valueAsNumber).catch(() => undefined); }} />}
    {view.state === "error" && <p role="alert" className="g-label" data-lines>{view.reason}</p>}{view.restart && <small className="g-label">Takes effect after a restart.</small>}
  </div>;
}
