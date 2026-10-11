import { useId, useRef, useState } from "react";
import type { Trunk } from "./notifications-browser";

/** A bounded, searchable multi-picker; an empty saved list means every Trunk. */
export function NotificationTrunks({ trunks, ids, disabled, onPick }: { trunks: Trunk[]; ids: string[]; disabled: boolean; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); setSearch(""); trigger.current?.focus(); };
  const options = [...trunks, ...ids.filter((id) => !trunks.some((t) => t.id === id)).map((id) => ({ id, name: id }))];
  const matches = options.filter((t) => t.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  return (
    <div className="nt-trunk-picker" onKeyDown={(event) => { if (open && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <button ref={trigger} type="button" className="btn" aria-label="Choose notification Trunks" aria-expanded={open} aria-controls={open ? panelId : undefined} disabled={disabled} onClick={() => { if (open) close(); else setOpen(true); }}>
        {ids.length ? `${ids.length} ${ids.length === 1 ? "Trunk" : "Trunks"} selected` : "Every Trunk"}
      </button>
      {open ? <div id={panelId} className="nt-trunk-panel" role="group" aria-label="Notification Trunks">
        <input className="inp" type="search" aria-label="Search Trunks" placeholder="Search Trunks" value={search} disabled={disabled} onChange={(event) => setSearch(event.target.value)} />
        <div className="nt-trunk-options">
          <label><input type="checkbox" checked={ids.length === 0} disabled={disabled} onChange={() => onPick("*")} />Every Trunk</label>
          {matches.map((t) => <label key={t.id}><input type="checkbox" checked={ids.includes(t.id)} disabled={disabled} onChange={() => onPick(t.id)} />{t.name}</label>)}
          {!matches.length ? <p role="status">{trunks.length ? "No matching Trunks." : "No Trunks available."}</p> : null}
        </div>
        <button type="button" className="btn" onClick={close}>Done</button>
      </div> : null}
    </div>
  );
}
