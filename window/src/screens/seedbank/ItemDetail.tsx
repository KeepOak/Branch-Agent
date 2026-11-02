// The item dialog (preview mkItemP17, preview.html:44528-44534): clicking a name shows what the item is before adding it:
// its summary, "By … · Official · Checked", its seed, then Version, What changed, Works on and Safety, with Close and
// "Add <name>" (or "Added ✓"). Facts the engine doesn't return are left out rather than guessed (#1049).
import { useState, type ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { Entry } from "./catalog";
import { Sheet, useDetail } from "./InstallSheet";
import { AddPill, Badges, ItemIcon, SeedIcons } from "./parts";

type Props = { entry: Entry; engine: WindowEngine; onClose: () => void; onAdd: (entry: Entry) => void };

export function ItemDetail({ entry, engine, onClose, onAdd }: Props) {
  const [notice, setNotice] = useState<ReactNode>(null);
  const detail = useDetail(engine, entry);
  const branch = entry.source.type === "template" || entry.by === "Branch";
  const version = detail.version ?? (branch ? "Comes with Branch" : undefined);
  const changed = detail.changed ?? (entry.installed ? "Nothing new since you added it." : undefined);
  const os = detail.os ?? (entry.kind === "plugins" || entry.kind === "mcp" ? undefined : "Every computer");
  const safety = entry.checked ? "Checked: clean" : detail.safety?.hidden ? "Look first: it tries to change a Trunk’s instructions." : "Not checked yet";
  const footer = <>
    <button type="button" className="sb-btn" data-local="" onClick={onClose}>Close</button>
    <AddPill entry={entry} engine={engine} onAdd={(e) => { onClose(); onAdd(e); }} text={"Add " + entry.name} />
  </>;
  return <Sheet title={entry.name} onClose={onClose} footer={footer}>
    <div className="sb-item">
      <ItemIcon entry={entry} size={64} />
      <div>
        {(detail.summary || entry.desc) && <p className="sb-item-sum g-label" data-lines>{detail.summary || entry.desc}</p>}
        <p className="sb-hint g-label">By {entry.by} · <Badges entry={entry} /></p>
      </div>
    </div>
    <div className="sb-item-seed"><SeedIcons entry={entry} onNotice={setNotice} /></div>
    {notice && <p className="sb-notice g-label" data-lines role="status">{notice} <button type="button" className="sb-x" data-local="" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button></p>}
    <dl className="sb-kv g-frost">
      {version && <><dt>Version</dt><dd>{version}</dd></>}
      {changed && <><dt>What changed</dt><dd>{changed}</dd></>}
      {os && <><dt>Works on</dt><dd>{os}</dd></>}
      <dt>Safety</dt><dd>{safety}</dd>
    </dl>
  </Sheet>;
}
