// Settings › Chat apps at Advanced: owners (commands.ownerAllowFrom), who may use commands (commands.allowFrom),
// where approvals go (approvals.exec.*), lists of people (accessGroups) and what Trunks may do in chats
// (tools.message.actions.allow, by the engine's action names in channels/plugins/message-action-names.ts).
import { useState } from "react";
import { Dialog } from "../../../shell/Dialog";
import { list, record, text, visible } from "../adapter";
import { Btn, Ctl, Field, Hint, Pick, Seg, Switch } from "../kit";
import { ChatLogo as Logo } from "./chatapps-logo";
import type { App, Trunk } from "./chatapps-data";
import { KeyRow, type Cfg } from "./chatapps-kit";

export type PCtx = { apps: App[]; cfg: Cfg; trunks: Trunk[] };
type Entry = [app: string, id: string];
const appName = (apps: App[], id: string) => (id === "*" ? "Every app" : apps.find((a) => a.id === id)?.name ?? visible(id));

/** Add-and-remove list of people by app, used by the owners, commands and list dialogs. */
function PeopleList({ apps, entries, every, onChange, ph }: { apps: App[]; entries: Entry[]; every?: boolean; onChange: (e: Entry[]) => void; ph: string }) {
  const choices = [...apps.map((a) => ({ id: a.id, label: a.name })), ...(every ? [{ id: "*", label: "Every app" }] : [])];
  const [app, setApp] = useState(choices[0]?.id ?? "");
  const [who, setWho] = useState("");
  const add = () => { const v = who.trim(); if (v && app) { onChange([...entries, [app, v]]); setWho(""); } };
  return (
    <>
      {entries.length ? <div className="rows">{entries.map(([a, n], i) => <div key={`${a}:${n}:${i}`} className="prow"><span className="grow"><b>{appName(apps, a)} · {visible(n)}</b></span><Btn ghost sm onClick={() => onChange(entries.filter((_, j) => j !== i))}>Remove</Btn></div>)}</div> : <Hint>No one yet.</Hint>}
      <div className="prow add-ca">
        <select className="inp" aria-label="App" value={app} onChange={(e) => setApp(e.target.value)}>{choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        <input className="inp" placeholder={ph} aria-label={ph} value={who} onChange={(e) => setWho(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Btn sm disabled={!who.trim() || !app} onClick={add}>Add</Btn>
      </div>
    </>
  );
}

const ownerEntries = (raw: unknown): Entry[] => (Array.isArray(raw) ? raw.map(String) : []).map((s) => { const i = s.indexOf(":"); return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : ["*", s]; });
function Owners({ apps, cfg }: PCtx) {
  const [open, setOpen] = useState(false);
  const entries = ownerEntries(cfg.get("commands.ownerAllowFrom"));
  const put = (e: Entry[]) => void cfg.set("commands.ownerAllowFrom", e.length ? e.map(([a, n]) => (a === "*" ? n : `${a}:${n}`)) : null);
  return (
    <Ctl title="Owners in chat apps" sub="Owners answer approvals and run owner commands from chat apps, and can export a conversation.">
      <Btn sm onClick={() => setOpen(true)}>{entries.length ? `${entries.length} ${entries.length === 1 ? "person" : "people"}` : "Edit"}</Btn>
      {open ? <Dialog title="Owners in chat apps" onClose={() => setOpen(false)} testid="chatapps-owners" footer={<button type="button" className="btn pri" onClick={() => setOpen(false)}>Done</button>}>
        <PeopleList apps={apps} entries={entries} onChange={put} ph="Their ID or @name" />
        <Hint>Owners can run owner-only commands, export a conversation and answer approvals from a chat app. The first person approved to message a Trunk can be made owner in the approve dialog.</Hint>
      </Dialog> : null}
    </Ctl>
  );
}

function CmdWho({ apps, cfg }: PCtx) {
  const [open, setOpen] = useState(false);
  const rec = record(cfg.get("commands.allowFrom"));
  const set = cfg.get("commands.allowFrom") !== undefined;
  const entries: Entry[] = Object.entries(rec).flatMap(([a, ids]) => (Array.isArray(ids) ? ids.map((n): Entry => [a, String(n)]) : []));
  const put = (e: Entry[]) => { const next: Record<string, string[]> = {}; for (const [a, n] of e) (next[a] ??= []).push(n); void cfg.set("commands.allowFrom", e.length ? next : null); };
  return (
    <>
      <Ctl title="Who may use commands" sub="Commands follow each app’s “Who may message it” unless you name people here.">
        <Seg label="Who may use commands" value={set ? "only" : "same"} options={[{ id: "same", label: "Same as who may message it" }, { id: "only", label: "Only these people" }]} disabled={cfg.loading} onChange={(v) => (v === "same" ? void cfg.set("commands.allowFrom", null) : setOpen(true))} />
      </Ctl>
      {set ? <Ctl title="These people" sub={entries.length ? entries.map(([a, n]) => `${appName(apps, a)} · ${visible(n)}`).join(", ") : "No one yet."}><Btn sm onClick={() => setOpen(true)}>Edit</Btn></Ctl> : null}
      {open ? <Dialog title="Who may use commands" onClose={() => setOpen(false)} testid="chatapps-cmdwho" footer={<button type="button" className="btn pri" onClick={() => setOpen(false)}>Done</button>}>
        <PeopleList apps={apps} entries={entries} every onChange={put} ph="Their ID or @name" />
        <Hint>Only these people may use commands; “Every app” entries count in every app.</Hint>
      </Dialog> : null}
    </>
  );
}

type Target = { channel: string; to: string; threadId?: string | number; accountId?: string };
function ApprovalsWhere({ apps, cfg, trunks }: PCtx) {
  const [chat, setChat] = useState({ app: apps[0]?.id ?? "", to: "", topic: "" });
  if (cfg.get("approvals.exec.enabled") !== true) return null;
  const mode = text(cfg.get("approvals.exec.mode") ?? "session");
  const targets = list(cfg.get("approvals.exec.targets")) as unknown as Target[];
  const put = (t: Target[]) => void cfg.set("approvals.exec.targets", t.length ? t : null);
  const add = () => { if (chat.app && chat.to.trim()) { put([...targets, { channel: chat.app, to: chat.to.trim(), ...(chat.topic.trim() ? { threadId: chat.topic.trim() } : {}) }]); setChat({ ...chat, to: "", topic: "" }); } };
  const af = cfg.get("approvals.exec.agentFilter");
  const agent = Array.isArray(af) && af.length ? String(af[0]) : "all";
  const sf = cfg.get("approvals.exec.sessionFilter");
  return (
    <>
      <KeyRow cfg={cfg} row={{ t: "Where", path: "approvals.exec.mode", kind: "seg", opts: [["The chat it came from", "session"], ["Chats I pick", "targets"], ["Both", "both"]], def: "session" }} />
      {mode !== "session" ? (
        <div className="rows list-ca">
          {targets.map((t, i) => <div key={`${t.channel}:${t.to}:${i}`} className="prow"><Logo id={t.channel} name={appName(apps, t.channel)} size={26} /><span className="grow"><b>{appName(apps, t.channel)} · {visible(t.to)}</b>{t.threadId !== undefined ? <small>Topic {visible(t.threadId)}</small> : null}</span><Btn ghost sm onClick={() => put(targets.filter((_, j) => j !== i))}>Remove</Btn></div>)}
          <div className="prow add-ca">
            <select className="inp" aria-label="App" value={chat.app} onChange={(e) => setChat({ ...chat, app: e.target.value })}>{apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            <input className="inp" placeholder="Chat name or ID" aria-label="Chat" value={chat.to} onChange={(e) => setChat({ ...chat, to: e.target.value })} />
            <input className="inp" placeholder="Topic (optional)" aria-label="Topic" value={chat.topic} onChange={(e) => setChat({ ...chat, topic: e.target.value })} />
            <Btn sm disabled={!chat.to.trim() || !chat.app} onClick={add}>Add a chat</Btn>
          </div>
        </div>
      ) : null}
      <Ctl title="Only for these Trunks"><Pick label="Only for these Trunks" value={agent} disabled={cfg.loading} options={[{ id: "all", label: "All Trunks" }, ...trunks.map((t) => ({ id: t.id, label: t.name }))]} onChange={(v) => void cfg.set("approvals.exec.agentFilter", v === "all" ? null : [v])} /></Ctl>
      <Ctl title="Only conversations matching" sub="Empty means all." stack><Field wide label="Only conversations matching" value={Array.isArray(sf) && sf.length ? String(sf[0]) : ""} disabled={cfg.loading} onCommit={(v) => void cfg.set("approvals.exec.sessionFilter", v.trim() ? [v.trim()] : null)} /></Ctl>
    </>
  );
}

/** The engine's message actions, grouped as the preview's six switches. */
const ALL_ACTIONS = ["send", "broadcast", "poll", "poll-vote", "react", "reactions", "read", "edit", "unsend", "reply", "sendWithEffect", "renameGroup", "setGroupIcon", "addParticipant", "removeParticipant", "leaveGroup", "sendAttachment", "delete", "pin", "unpin", "list-pins", "permissions", "thread-create", "thread-list", "thread-reply", "search", "sticker", "sticker-search", "member-info", "role-info", "emoji-list", "emoji-upload", "sticker-upload", "role-add", "role-remove", "channel-info", "channel-list", "channel-create", "conversation-open", "channel-edit", "channel-delete", "channel-move", "category-create", "category-edit", "category-delete", "topic-create", "topic-edit", "voice-status", "event-list", "event-create", "timeout", "kick", "ban", "set-profile", "set-presence", "download-file", "upload-file"];
const GROUPS: [string, string[]][] = [
  ["React to messages", ["react", "reactions"]], ["Edit and delete its own messages", ["edit", "unsend", "delete"]], ["Pin messages", ["pin", "unpin", "list-pins"]],
  ["Read earlier messages and search", ["read", "search"]], ["Threads, polls, emoji and stickers", ["thread-create", "thread-list", "thread-reply", "poll", "poll-vote", "emoji-list", "sticker", "sticker-search"]],
  ["Look up members and permissions", ["member-info", "role-info", "permissions"]],
];
export function actionsAfter(allow: string[] | undefined, group: string[], on: boolean): string[] | null {
  const base = allow ?? ALL_ACTIONS;
  const next = on ? [...new Set([...base, ...group])] : base.filter((a) => !group.includes(a));
  return ALL_ACTIONS.every((a) => next.includes(a)) ? null : next;
}
function Actions({ cfg }: PCtx) {
  const raw = cfg.get("tools.message.actions.allow");
  const allow = Array.isArray(raw) ? raw.map(String) : undefined;
  return <>{GROUPS.map(([t, g]) => (
    <Ctl key={t} title={t}><Switch checked={!allow || g.every((a) => allow.includes(a))} label={t} disabled={cfg.loading} onChange={(on) => void cfg.set("tools.message.actions.allow", actionsAfter(allow, g, on))} /></Ctl>
  ))}</>;
}

export function peoplePart(id: string, ctx: PCtx) {
  if (id === "owners") return <Owners {...ctx} />;
  if (id === "cmdWho") return <CmdWho {...ctx} />;
  if (id === "apprWhere") return <ApprovalsWhere {...ctx} />;
  if (id === "actions") return <Actions {...ctx} />;
  return null;
}
