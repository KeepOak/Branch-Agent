// Inbox's "Recent notices" bell (preview 40-places noticesPopPD18): at the right end of the tab row, before
// "Mark all read". It lists what the engine reports as a notice today: a Trunk waiting for your answer.
// The button says "Notifications" next to the bell so it is never an unlabeled icon (UI audit DA-35).
import { useState } from "react";
import { Popover } from "../../shell/Popover";
import type { MenuAnchor } from "../../shell/Menu";
import { Icon } from "../../shell/icons";
import { G } from "./glyphs";
import { agentName } from "../overview/engine";
import { str, type Needs } from "./data";

type Props = { data: Needs | null; openConversation: (key: string) => void; openSettings?: (page: string) => void };

export function NoticesBell({ data, openConversation, openSettings }: Props) {
  const [at, setAt] = useState<MenuAnchor | null>(null);
  const asks = (data?.questions ?? []).map(q => ({ id: str(q.id), key: str(q.sessionKey), name: agentName(data?.agents.list ?? [], str(q.agentId)) || "A Trunk" }));
  const close = () => setAt(null);
  return <>
    <button type="button" className="ib-bell" aria-haspopup="dialog" aria-expanded={Boolean(at)}
      onClick={e => { if (at) { close(); return; } const r = e.currentTarget.getBoundingClientRect(); setAt({ x: r.right - 300, y: r.bottom + 6 }); }}>
      <Icon name="bell" small />
      <span>Notifications</span>
    </button>
    {at ? <Popover at={at} onClose={close} label="Recent notices" testid="inbox-notices">
      <div className="ph">Recent notices</div>
      {asks.length ? <div className="ib-ntl">{asks.map(a => <div className="ib-nt" key={a.id}>
        <span className="ib-nt-i"><G name="question" size={14} /></span>
        {a.key ? <button type="button" className="ib-nt-t" onClick={() => { close(); openConversation(a.key); }}>{a.name} is waiting for your answer.</button> : <span className="ib-nt-t">{a.name} is waiting for your answer.</span>}
      </div>)}</div> : <p className="ib-hint ib-nt-none">No notices right now.</p>}
      <div className="ib-nt-f"><span className="ib-grow-x" /><button type="button" className="ib-nt-link" disabled={!openSettings} onClick={() => { close(); openSettings?.("notifications"); }}>Notification settings</button></div>
    </Popover> : null}
  </>;
}
