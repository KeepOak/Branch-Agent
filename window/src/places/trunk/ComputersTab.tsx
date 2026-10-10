// Trunk editor › Its computers (preview 31-trunksp itsCompsPC18): this computer and every paired one from node.list.
// The engine lets every Trunk use every paired computer, so the ticks are fixed; where a new conversation's commands
// run is the Trunk's tools.exec host/node.
import { Segmented } from "../../shell/Popover";
import { Icon } from "../../shell/icons";
import { Saved } from "./EditControls";
import { LineIcon } from "./TrunkFace";
import type { Draft } from "./api";
import type { Computer } from "./data";
import type { May } from "./may";

export const ALLOW_WHY = "Every Trunk may use every paired computer; the engine keeps no list per Trunk.";
const OS: Record<string, string> = { darwin: "macOS", macos: "macOS", win32: "Windows", windows: "Windows", linux: "Linux", ios: "iPhone", android: "Android" };
const iconFor = (platform: string) => (/darwin|mac/i.test(platform) ? "laptop" : /linux/i.test(platform) ? "server" : "monitor");

function Row({ c, who }: { c: { id: string; name: string; line: string; icon: string }; who: string }) {
  return (
    <label className="tk-comp" title={ALLOW_WHY}>
      <input type="checkbox" checked disabled aria-label={`${who} may use ${c.name}`} />
      <span className="tk-ico">{c.icon === "monitor" ? <Icon name="monitor" small /> : <LineIcon name={c.icon} />}</span>
      <span className="tk-grow"><b>{c.name}</b><small>{c.line}</small></span>
    </label>
  );
}

type Props = { name: string; draft: Draft; computers: Computer[]; set: (d: Partial<Draft>) => void; openSettings?: (page: string) => void };
export function ComputersTab({ name, draft, computers, set, openSettings }: Props) {
  const rows = [
    { id: "this", name: "This computer", line: "Where Branch runs", icon: "monitor" },
    ...computers.map((c) => ({ id: c.id, name: c.name, line: [OS[c.platform.toLowerCase()] || c.platform, c.connected ? "online" : "offline"].filter(Boolean).join(" · "), icon: iconFor(c.platform) })),
  ];
  // Commands can only run on a computer that is online; the saved one stays listed so it can be changed.
  const usable = rows.filter((r) => r.id === "this" || r.id === draft.may.startOn || computers.some((c) => c.id === r.id && c.connected));
  const known = rows.some((r) => r.id === draft.may.startOn);
  const options = [...usable.map((r) => ({ id: r.id, name: r.name })), ...(known ? [] : [{ id: draft.may.startOn, name: draft.may.startOn }])];
  const offline = computers.some((c) => !c.connected && c.id !== draft.may.startOn);
  const setMay = (m: Partial<May>) => set({ may: { ...draft.may, ...m } });
  return (
    <div className="tk-its">
      <p className="tk-hint">Which computers {name} may use. Each task runs on one; a conversation can pick which.</p>
      <div className="tk-comps">{rows.map((r) => <Row key={r.id} c={r} who={name} />)}</div>
      <p className="tk-hint tk-its-line">{name} has no limit of its own on tasks at once, on one computer or several.</p>
      <div className="tk-its-ctl">
        <span><b>A new conversation starts on</b><small>{offline ? "You can change it in the conversation’s computer menu. An offline computer can be picked once it’s back." : "You can change it in the conversation’s computer menu."}</small></span>
        <Segmented label="A new conversation starts on" value={draft.may.startOn} options={options} onChange={(startOn) => setMay({ startOn })} />
        <Saved field="startOn" />
      </div>
      <div className="tk-offer" role="note">
        <span className="tk-ico"><LineIcon name="cloud" /></span>
        <span className="tk-grow"><b>Add a cloud computer</b><small>A fresh computer for each conversation, removed when work stops.</small></span>
        <button type="button" className="btn sm" disabled={!openSettings} onClick={() => openSettings?.("computer")}>Set one up</button>
      </div>
    </div>
  );
}
