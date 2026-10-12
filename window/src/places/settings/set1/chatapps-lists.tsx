// Settings › Chat apps › Lists of people (Advanced): the engine's access groups (accessGroups.<name>), either
// people named per app (type message.senders) or everyone who can see a Discord channel (discord.channelAudience).
// An app's "Use a list" puts accessGroup:<name> in its allowFrom.
import { useState } from "react";
import { Dialog } from "../../../shell/Dialog";
import { record, visible, type RecordValue } from "../adapter";
import { Btn, Hint, Seg } from "../kit";
import type { App } from "./chatapps-data";
import type { Cfg } from "./chatapps-kit";

type Group = { type: "message.senders"; members: Record<string, string[]> } | { type: "discord.channelAudience"; guildId: string; channelId: string };
type Draft = { name: string; g: Group };
const USERS = <svg className="i s" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M10 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 5.2a3 3 0 0 1 0 5.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;

function summary(g: RecordValue, apps: App[]): string {
  if (g.type === "discord.channelAudience") return `Everyone who can see ${visible(g.guildId)} › ${visible(g.channelId)}`;
  const m = record(g.members);
  const n = Object.values(m).reduce<number>((s, v) => s + (Array.isArray(v) ? v.length : 0), 0);
  const names = Object.keys(m).map((a) => (a === "*" ? "Every app" : apps.find((x) => x.id === a)?.name ?? visible(a)));
  return `${n} ${n === 1 ? "person" : "people"} · ${names.join(", ") || "no apps"}`;
}

export function Lists({ apps, cfg }: { apps: App[]; cfg: Cfg }) {
  const [edit, setEdit] = useState<{ old: string | null; d: Draft } | null>(null);
  const groups = Object.entries(record(cfg.get("accessGroups")));
  return (
    <>
      {groups.length ? (
        <div className="rows">{groups.map(([name, g]) => (
          <div key={name} className="prow"><span className="ico-ca">{USERS}</span><span className="grow"><b>{visible(name)}</b><small>{summary(record(g), apps)}</small></span>
            <Btn ghost sm onClick={() => setEdit({ old: name, d: { name, g: record(g) as unknown as Group } })}>Edit</Btn></div>
        ))}</div>
      ) : <Hint>No lists yet.</Hint>}
      <div className="acts"><Btn sm onClick={() => setEdit({ old: null, d: { name: "", g: { type: "message.senders", members: {} } } })}>New list</Btn></div>
      <Hint>A list lets no one in by itself. Use it in “Who may message it” or a group’s list.</Hint>
      {edit ? <ListDialog apps={apps} cfg={cfg} old={edit.old} start={edit.d} onClose={() => setEdit(null)} /> : null}
    </>
  );
}

function ListDialog({ apps, cfg, old, start, onClose }: { apps: App[]; cfg: Cfg; old: string | null; start: Draft; onClose: () => void }) {
  const [d, setD] = useState<Draft>(start);
  const [error, setError] = useState("");
  const [del, setDel] = useState(false);
  const save = async () => {
    const name = d.name.trim();
    if (!name || name.includes(".")) { setError(name ? "A list name can’t have a full stop in it." : "Give the list a name."); return; }
    if (old && old !== name && !(await cfg.set(`accessGroups.${old}`, null))) return;
    if (await cfg.set(`accessGroups.${name}`, d.g)) onClose();
  };
  const remove = async () => { if (old && (await cfg.set(`accessGroups.${old}`, null))) onClose(); };
  if (del) return (
    <Dialog title={`Delete ${visible(old)}?`} onClose={() => setDel(false)} testid="chatapps-list-delete" footer={<><button type="button" className="btn ghost" onClick={() => setDel(false)}>Cancel</button><button type="button" className="btn bad" onClick={() => void remove()}>Delete list</button></>}>
      <p className="dlg-p-ca">Places that use it stop letting those people in.</p>
    </Dialog>
  );
  return (
    <Dialog title={old ? `Edit ${visible(old)}` : "New list"} onClose={onClose} testid="chatapps-list" footer={<>{old ? <button type="button" className="btn ghost" onClick={() => setDel(true)}>Delete list</button> : null}<button type="button" className="btn ghost" onClick={onClose}>Cancel</button><button type="button" className="btn pri" onClick={() => void save()}>Save</button></>}>
      <label className="fld"><span>Name</span><input className="inp" value={d.name} aria-label="Name" onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
      <div className="fld"><span>Kind</span>
        <Seg label="Kind" value={d.g.type} options={[{ id: "message.senders", label: "People I name" }, { id: "discord.channelAudience", label: "Everyone who can see a Discord channel" }]}
          onChange={(t) => setD({ ...d, g: t === "message.senders" ? { type: "message.senders", members: {} } : { type: "discord.channelAudience", guildId: "", channelId: "" } })} />
      </div>
      {d.g.type === "discord.channelAudience" ? <DiscordFields g={d.g} onChange={(g) => setD({ ...d, g })} /> : <Members apps={apps} g={d.g} onChange={(g) => setD({ ...d, g })} />}
      {error ? <p className="bs-error" role="alert">{error}</p> : null}
    </Dialog>
  );
}

function DiscordFields({ g, onChange }: { g: Extract<Group, { type: "discord.channelAudience" }>; onChange: (g: Group) => void }) {
  return (
    <>
      <label className="fld"><span>Server ID</span><input className="inp" aria-label="Server ID" value={g.guildId} onChange={(e) => onChange({ ...g, guildId: e.target.value })} /></label>
      <label className="fld"><span>Channel ID</span><input className="inp" aria-label="Channel ID" value={g.channelId} onChange={(e) => onChange({ ...g, channelId: e.target.value })} /></label>
    </>
  );
}

function Members({ apps, g, onChange }: { apps: App[]; g: Extract<Group, { type: "message.senders" }>; onChange: (g: Group) => void }) {
  const [app, setApp] = useState(apps[0]?.id ?? "*");
  const [who, setWho] = useState("");
  const rows = Object.entries(g.members).flatMap(([a, ids]) => ids.map((id) => [a, id] as const));
  const add = () => { const v = who.trim(); if (!v) return; onChange({ ...g, members: { ...g.members, [app]: [...(g.members[app] ?? []), v] } }); setWho(""); };
  const drop = (a: string, id: string) => { const left = (g.members[a] ?? []).filter((x) => x !== id); const m = { ...g.members, [a]: left }; if (!left.length) delete m[a]; onChange({ ...g, members: m }); };
  return (
    <>
      {rows.length ? <div className="rows">{rows.map(([a, id]) => <div key={`${a}:${id}`} className="prow"><span className="grow"><b>{a === "*" ? "Every app" : apps.find((x) => x.id === a)?.name ?? visible(a)} · {visible(id)}</b></span><Btn ghost sm onClick={() => drop(a, id)}>Remove</Btn></div>)}</div> : null}
      <div className="prow add-ca">
        <select className="inp" aria-label="App" value={app} onChange={(e) => setApp(e.target.value)}>{apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}<option value="*">Every app</option></select>
        <input className="inp" placeholder="Their ID" aria-label="Their ID" value={who} onChange={(e) => setWho(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Btn sm disabled={!who.trim()} onClick={add}>Add</Btn>
      </div>
    </>
  );
}
