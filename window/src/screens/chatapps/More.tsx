// R1 Chat apps at Advanced and Technical: the preview's approved cards (rows.ts CARDS: Who may message, How replies look &
// arrive, Groups, Commands, Approvals & what Trunks may do, Each app, Limits & quiet), each gathering Classic's Settings ›
// Chat apps tables (places/settings/set1/chatapps-tables) with every working control kept (README rule 6) and every row
// Classic greys kept as Coming with its reason. The page's own rows (rows.ts BASE_ROWS) draw in their Classic row's place. Table rows draw through RowView (rows.ts MORE_ROWS); the rows that read engine data are drawn here, and so is
// Manage's Advanced part (AppMore: its commands, groups by ID, Discord server actions, health with Check now, accounts
// with Add another account, and every setting the app has with Save and Reload).
import { Fragment, useMemo, useState, type ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import { canAll, requestOrComing } from "../../connect/capabilities";
import { errorText, list, record, text, visible, type RecordValue } from "../../places/settings/adapter";
import { useResource } from "../../places/settings/hooks";
import { showsInternals } from "../../places/settings/internals";
import { LogsDialog } from "../../places/settings/set2/advanced-tech";
import { ChatLogo } from "../../places/settings/set1/chatapps-logo";
import { acctLine, acctTone, ago, PILL_WORDS, type Acct, type App, type CatalogueApp, type Trunk } from "../../places/settings/set1/chatapps-data";
import type { Row as ClassicRow } from "../../places/settings/set1/chatapps-kit";
import { NO_KEY } from "../../places/settings/set1/chatapps-kit";
import { QUEUE_MODES } from "../../places/settings/set1/chatapps-tables";
import { NATIVE } from "../../places/settings/set1/chatapps-parts";
import { actionsAfter } from "../../places/settings/set1/chatapps-people";
import { DEPTH as DEPTH_APPS, MSG_KEYS } from "../../places/settings/set1/chatapps-depth";
import { joinHuddlesOn, setJoinHuddles } from "../../places/settings/set1/slack-huddles";
import { fieldsOf } from "../../places/settings/set1/chatapps-manage-more";
import { RowView, Segmented, Toggle } from "../settings/RowView";
import type { Level } from "../settings/nav";
import { Alert, Hint, Input, KeyLine, Line, LinesRow, PeopleList, Pill, appName, toneOf, type Cfg, type Entry } from "./parts";
import { BASE_ROWS, CARDS, MORE_ROWS, MORE_SECTIONS, baseFor, drawnAbove } from "./rows";
import { ChatAppRow } from "./Settings";
import type { ChatApp } from "./catalogue";

type Ctx = { engine: WindowEngine; cfg: Cfg; apps: App[]; all: CatalogueApp[]; trunks: Trunk[]; level: Level };

/** Advanced and Technical: the approved cards, in the preview's order. */
export function More(ctx: Ctx) {
  const draw = (r: ClassicRow) => {
    if (r.kind === "custom") return <Part ctx={ctx} id={r.id ?? r.t} row={r} />;
    if (drawnAbove(r)) { const own = baseFor(r); return own && own.level <= ctx.level ? <ChatAppRow engine={ctx.engine} row={own} /> : null; }
    const row = MORE_ROWS.get(r);
    if (!row) return null;
    return r.kind === "lines" && row.source.kind === "config" ? <LinesRow engine={ctx.engine} row={row} /> : <RowView engine={ctx.engine} row={row} />;
  };
  const inTables = new Set(MORE_SECTIONS.flatMap((s) => s.rows).flatMap((r) => (drawnAbove(r) ? [baseFor(r)?.id] : [])));
  return (
    <div className="r1-ca-more">
      {CARDS.map(([card, titles]) => {
        const secs = MORE_SECTIONS.filter((s) => titles.includes(s.title) && s.lv <= ctx.level);
        // The page's own rows that no Classic table has: drawn first in their card.
        const own = BASE_ROWS.filter((b) => b.card === card && !inTables.has(b.id) && b.level <= ctx.level);
        if (!secs.length && !own.length) return null;
        const parts = secs.map((sec) => (
          <div key={sec.title} className="r1-ca-part" data-sec={sec.title}>
            {sec.hint ? <Hint>{sec.hint}</Hint> : null}
            {sec.rows.filter((r) => (r.lv ?? sec.lv) <= ctx.level).map((r) => <Fragment key={r.id ?? r.t}>{draw(r)}</Fragment>)}
            {sec.after ? <Hint>{sec.after}</Hint> : null}
          </div>
        ));
        // Who answers is drawn above with its own heading; its Advanced rows follow it with none.
        if (card === "Who answers") return <div key={card} className="r1-ca-sec r1-ca-cont" data-card={card} aria-label={card}>{parts}</div>;
        return (
          <section key={card} className="r1-ca-sec" data-card={card} aria-label={card}>
            <h2 className="g-label">{card}</h2>
            {own.map((b) => <ChatAppRow key={b.id} engine={ctx.engine} row={b} />)}
            {parts}
          </section>
        );
      })}
    </div>
  );
}

/** The chat commands a person types in any chat app (Classic chatapps-parts CmdRows). */
const CHAT_COMMANDS: [string, string][] = [
  ["/new", "Starts a fresh conversation in this chat."], ["/stop", "Stops what the Trunk is doing here."], ["/model", "Shows or changes the model for this chat."],
  ["/config", "Reads or changes Branch settings. Owners only."], ["/approve", "Answers an approval request."],
];
/** The app surfaces messages.queue.byChannel accepts (engine QueueModeBySurfaceSchema), as in Classic. */
const QUEUE_SURFACES = new Set(["whatsapp", "telegram", "discord", "irc", "googlechat", "slack", "mattermost", "signal", "imessage", "msteams", "webchat", "matrix"]);
const PROGRESS_APPS = ["Slack", "Discord", "Signal", "Telegram", "WhatsApp"];
/** The engine's message actions, as Classic's six switches (chatapps-people). */
const ACTION_GROUPS: [string, string[]][] = [
  ["React to messages", ["react", "reactions"]], ["Edit and delete its own messages", ["edit", "unsend", "delete"]], ["Pin messages", ["pin", "unpin", "list-pins"]],
  ["Read earlier messages and search", ["read", "search"]], ["Threads, polls, emoji and stickers", ["thread-create", "thread-list", "thread-reply", "poll", "poll-vote", "emoji-list", "sticker", "sticker-search"]],
  ["Look up members and permissions", ["member-info", "role-info", "permissions"]],
];
const NOT_KNOWN = <Pill tone="idle">Not known</Pill>;

function Part({ ctx, id, row }: { ctx: Ctx; id: string; row: ClassicRow }): ReactNode {
  const { cfg, apps } = ctx;
  if (id.startsWith("code:")) return <Line label={row.t} help={row.sub}><code className="r1-ca-code-line g-label">{id.slice(5)}</code></Line>;
  switch (id) {
    case "cmdRows": return <div className="r1-ca-list">{CHAT_COMMANDS.map(([name, what]) => <Line key={name} label={<code>{name}</code>} help={what} />)}<Hint>Who may use them is set in “Who may use commands”, under Commands from chat apps.</Hint></div>;
    case "watch": {
      const on = apps.length > 0 && apps.every((a) => cfg.get("channels." + a.id + ".healthMonitor.enabled") !== false);
      const sub = "If no update arrives for a while, Branch reconnects it and tells you if that fails.";
      return <Line label={row.t} help={!apps.length ? sub + " Turns on with your first chat app." : on ? sub + " On because a chat app is connected." : sub} ctlNeed="config.patch">
        <Toggle label={row.t} on={on} disabled={!apps.length || !cfg.ready} onChange={(v) => { for (const a of apps) void cfg.set("channels." + a.id + ".healthMonitor.enabled", v ? null : false); }} />
      </Line>;
    }
    case "watchdog": return apps.length ? <div className="r1-ca-list">{apps.map((a) => {
      const m = a.accounts[0];
      const tone = m ? acctTone(m) : a.tone;
      const line = !m || tone === "bad" ? "Watchdog: stopped" + (m?.lastError ? " · " + a.sub : "") : "Watchdog: last update " + (ago(m.lastTransportActivityAt ?? m.lastInboundAt) || "not yet") + " · reconnected " + (m.reconnectAttempts ?? 0) + " times";
      return <div key={a.id} className="r1-ca-app"><ChatLogo id={a.id} name={a.name} size={24} /><span className="g-label" data-lines><b>{a.name}</b> <small>{line}</small></span><Pill tone={toneOf(tone)}>{PILL_WORDS[tone]}</Pill></div>;
    })}</div> : null;
    case "watchLog": return <WatchLog engine={ctx.engine} row={row} />;
    case "formatting": {
      const later = ctx.all.filter((c) => NATIVE[c.id] && !apps.some((a) => a.id === c.id));
      const rows = [...apps.map((a) => ({ id: a.id, name: a.name, on: true })), ...later.map((c) => ({ id: c.id, name: c.name, on: false }))];
      if (!rows.length) return <Hint>Each app’s formatting shows here once it is connected.</Hint>;
      return <>{rows.map((a) => <Line key={a.id} label={a.on ? a.name : a.name + " (when connected)"} help={"Bold, lists and links are turned into what " + a.name + " shows."} coming="Each app’s own formatting is always used.">
        <Segmented label={"Formatting in " + a.name} value="own" options={[{ v: "own", label: NATIVE[a.id] ?? "Its own styles" }, { v: "plain", label: "Plain text" }]} disabled onChange={() => undefined} />
      </Line>)}</>;
    }
    case "queueByApp": return apps.length ? <><Hint>Per app</Hint>{apps.map((a) => <KeyLine key={a.id} cfg={cfg} row={{ t: a.name, kind: "pick", opts: [["As above", undefined], ...QUEUE_MODES], ...(QUEUE_SURFACES.has(a.id) ? { path: "messages.queue.byChannel." + a.id } : { off: a.name + " follows the choice above." }) }} />)}</> : null;
    case "progress": {
      const on = cfg.get("messages.statusReactions.enabled");
      return <Line label={row.t} help="The reaction on your message changes as the Trunk works and finishes. Slack keeps its own “is thinking” status as well." coming={showsInternals(ctx.level) ? "Branch has one switch for every app (messages.statusReactions.enabled)." : "Branch has one switch for every app."}>
        <span className="r1-ca-chips">{PROGRESS_APPS.map((n) => <button key={n} type="button" aria-pressed={n === "Discord" ? on !== false : on === true} disabled>{n}</button>)}</span>
      </Line>;
    }
    case "delayMin": case "delayMax": {
      if (cfg.get("agents.defaults.humanDelay.mode") !== "custom") return null;
      const min = id === "delayMin";
      return <KeyLine cfg={cfg} row={{ t: min ? "Shortest" : "Longest", path: "agents.defaults.humanDelay." + (min ? "minMs" : "maxMs"), kind: "num", unit: "ms", def: min ? 800 : 2500 }} />;
    }
    case "owners": return <Owners ctx={ctx} />;
    case "cmdWho": return <CmdWho ctx={ctx} />;
    case "apprWhere": return <ApprovalsWhere ctx={ctx} />;
    case "actions": {
      const raw = cfg.get("tools.message.actions.allow");
      const allow = Array.isArray(raw) ? raw.map(String) : undefined;
      return <>{ACTION_GROUPS.map(([t, g]) => <Line key={t} label={t} ctlNeed="config.patch"><Toggle label={t} on={!allow || g.every((a) => allow.includes(a))} disabled={!cfg.ready} onChange={(on) => void cfg.set("tools.message.actions.allow", actionsAfter(allow, g, on))} /></Line>)}</>;
    }
    case "lists": return <Lists ctx={ctx} />;
    case "msgKeys": return <MsgKeys cfg={cfg} />;
    case "depth": return <Depth ctx={ctx} />;
    case "updates": return <Line label={row.t} help={row.sub} coming="Branch can’t tell yet whether an update keeps them running.">{NOT_KNOWN}</Line>;
    case "relay": return <Line label={row.t} help={row.sub} coming="Branch can’t tell yet how a relay sends.">{NOT_KNOWN}</Line>;
    case "muted": return <Line label={row.t} help={row.sub} coming={NO_KEY}><select aria-label="Chat to mute" disabled><option>Choose a chat</option></select><select aria-label="For how long" disabled><option>1 hour</option><option>Until tomorrow</option><option>Until I unmute it</option></select><button type="button" disabled>Mute</button></Line>;
    case "takeover": return <Line label={row.t} help={row.sub} coming={NO_KEY}><button type="button" disabled>Take over</button></Line>;
    case "forward": return <Line label={row.t} help={row.sub} coming={NO_KEY}><button type="button" disabled>Add a rule</button></Line>;
    case "ownCmds": return <Line label={row.t} help={row.sub} coming="Only Telegram has its own commands, on its page."><button type="button" disabled>Add a command</button></Line>;
    default: return null;
  }
}

function WatchLog({ engine, row }: { engine: WindowEngine; row: ClassicRow }) {
  const [open, setOpen] = useState(false);
  return <Line label={row.t} help={row.sub} ctlNeed="logs.tail">
    <button type="button" data-need="logs.tail" onClick={() => setOpen(true)}>Open watchdog log</button>
    {open ? <LogsDialog engine={engine} source={{ name: "Watchdog", filter: "health-monitor" }} onClose={() => setOpen(false)} /> : null}
  </Line>;
}

const ownerEntries = (raw: unknown): Entry[] => (Array.isArray(raw) ? raw.map(String) : []).map((s) => { const i = s.indexOf(":"); return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : ["*", s]; });
const people = (n: number) => n + " " + (n === 1 ? "person" : "people");

/** Owners in chat apps (commands.ownerAllowFrom). */
function Owners({ ctx: { cfg, apps } }: { ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const entries = ownerEntries(cfg.get("commands.ownerAllowFrom"));
  const put = (e: Entry[]) => void cfg.set("commands.ownerAllowFrom", e.length ? e.map(([a, n]) => (a === "*" ? n : a + ":" + n)) : null);
  return <>
    <Line label="Owners in chat apps" help="Owners answer approvals and run owner commands from chat apps, and can export a conversation." ctlNeed="config.patch">
      <button type="button" aria-expanded={open} data-need="config.patch" disabled={!cfg.ready} onClick={() => setOpen(!open)}>{open ? "Done" : entries.length ? people(entries.length) : "Edit"}</button>
    </Line>
    {open ? <div className="r1-ca-editor" role="group" aria-label="Owners in chat apps"><PeopleList apps={apps} entries={entries} every onChange={put} ph="Their ID or @name" disabled={!cfg.ready} /><Hint>The first person approved to message a Trunk can be made owner when you approve them.</Hint></div> : null}
  </>;
}

/** Who may use commands (commands.allowFrom): as who may message it, or only the people named. */
function CmdWho({ ctx: { cfg, apps } }: { ctx: Ctx }) {
  const [open, setOpen] = useState(false);
  const raw = cfg.get("commands.allowFrom");
  const set = raw !== undefined && raw !== null;
  const entries: Entry[] = Object.entries(record(raw)).flatMap(([a, ids]) => (Array.isArray(ids) ? ids.map((n): Entry => [a, String(n)]) : []));
  const put = (e: Entry[]) => { const next: Record<string, string[]> = {}; for (const [a, n] of e) (next[a] ??= []).push(n); void cfg.set("commands.allowFrom", e.length ? next : null); };
  return <>
    <Line label="Who may use commands" help="Commands follow each app’s “Who may message it” unless you name people here." ctlNeed="config.patch">
      <Segmented label="Who may use commands" value={set || open ? "only" : "same"} options={[{ v: "same", label: "Same as who may message it" }, { v: "only", label: "Only these people" }]} disabled={!cfg.ready} onChange={(v) => { if (v === "same") { setOpen(false); void cfg.set("commands.allowFrom", null); } else setOpen(true); }} />
    </Line>
    {set || open ? <div className="r1-ca-editor" role="group" aria-label="These people"><PeopleList apps={apps} entries={entries} every onChange={put} ph="Their ID or @name" disabled={!cfg.ready} /><Hint>Only these people may use commands; “Every app” entries count in every app.</Hint></div> : null}
  </>;
}

type Target = { channel: string; to: string; threadId?: string | number };
/** Where approvals go (approvals.exec.mode, targets, agentFilter, sessionFilter), once they go to chat apps. */
function ApprovalsWhere({ ctx: { cfg, apps, trunks } }: { ctx: Ctx }) {
  const [chat, setChat] = useState({ app: "", to: "", topic: "" });
  if (cfg.get("approvals.exec.enabled") !== true) return null;
  const app = chat.app || apps[0]?.id || "";
  const mode = typeof cfg.get("approvals.exec.mode") === "string" ? String(cfg.get("approvals.exec.mode")) : "session";
  const targets = list(cfg.get("approvals.exec.targets")) as unknown as Target[];
  const put = (t: Target[]) => void cfg.set("approvals.exec.targets", t.length ? t : null);
  const add = () => { if (app && chat.to.trim()) { put([...targets, { channel: app, to: chat.to.trim(), ...(chat.topic.trim() ? { threadId: chat.topic.trim() } : {}) }]); setChat({ ...chat, to: "", topic: "" }); } };
  const af = cfg.get("approvals.exec.agentFilter");
  const sf = cfg.get("approvals.exec.sessionFilter");
  return <>
    <KeyLine cfg={cfg} row={{ t: "Where", path: "approvals.exec.mode", kind: "seg", opts: [["The chat it came from", "session"], ["Chats I pick", "targets"], ["Both", "both"]], def: "session" }} />
    {mode !== "session" ? <div className="r1-ca-editor" role="group" aria-label="Chats approvals go to">
      {targets.map((t, i) => <div key={t.channel + ":" + t.to + ":" + i} className="r1-ca-person"><span className="g-label">{appName(apps, t.channel)} · {visible(t.to)}{t.threadId !== undefined ? " · Topic " + visible(t.threadId) : ""}</span><button type="button" disabled={!cfg.ready} data-need="config.patch" onClick={() => put(targets.filter((_, j) => j !== i))}>Remove</button></div>)}
      <div className="r1-ca-add">
        <select aria-label="App" value={app} data-local="" onChange={(e) => setChat({ ...chat, app: e.target.value })}>{apps.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <input className="r1s-inp" placeholder="Chat name or ID" aria-label="Chat" value={chat.to} onChange={(e) => setChat({ ...chat, to: e.target.value })} />
        <input className="r1s-inp" placeholder="Topic (optional)" aria-label="Topic" value={chat.topic} onChange={(e) => setChat({ ...chat, topic: e.target.value })} />
        <button type="button" disabled={!cfg.ready || !chat.to.trim() || !app} data-need="config.patch" onClick={add}>Add a chat</button>
      </div>
    </div> : null}
    <Line label="Only for these Trunks" ctlNeed="config.patch">
      <select className="r1s-inp" aria-label="Only for these Trunks" value={Array.isArray(af) && af.length ? String(af[0]) : "all"} disabled={!cfg.ready} onChange={(e) => void cfg.set("approvals.exec.agentFilter", e.target.value === "all" ? null : [e.target.value])}>
        <option value="all">All Trunks</option>{trunks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </Line>
    <Line label="Only conversations matching" help="Empty means all." stack ctlNeed="config.patch">
      <Input label="Only conversations matching" value={Array.isArray(sf) && sf.length ? String(sf[0]) : ""} disabled={!cfg.ready} onSave={(v) => void cfg.set("approvals.exec.sessionFilter", v.trim() ? [v.trim()] : null)} />
    </Line>
  </>;
}

type Group = { type: "message.senders"; members: Record<string, string[]> } | { type: "discord.channelAudience"; guildId: string; channelId: string };
function summary(g: RecordValue, apps: App[]): string {
  if (g.type === "discord.channelAudience") return "Everyone who can see " + visible(g.guildId) + " › " + visible(g.channelId);
  const m = record(g.members);
  const n = Object.values(m).reduce<number>((s, v) => s + (Array.isArray(v) ? v.length : 0), 0);
  return people(n) + " · " + (Object.keys(m).map((a) => appName(apps, a)).join(", ") || "no apps");
}
/** Lists of people (accessGroups.<name>): people named per app, or everyone who can see a Discord channel. */
function Lists({ ctx: { cfg, apps } }: { ctx: Ctx }) {
  const [edit, setEdit] = useState<{ old: string | null; name: string; g: Group } | null>(null);
  const groups = Object.entries(record(cfg.get("accessGroups")));
  return <>
    {groups.length ? groups.map(([name, g]) => <Line key={name} label={visible(name)} help={summary(record(g), apps)} ctlNeed="config.patch"><button type="button" disabled={!cfg.ready} onClick={() => setEdit({ old: name, name, g: record(g) as unknown as Group })}>Edit</button></Line>) : <Hint>No lists yet.</Hint>}
    {edit ? <ListEditor apps={apps} cfg={cfg} start={edit} onClose={() => setEdit(null)} /> : <div className="r1-ca-acts"><button type="button" disabled={!cfg.ready} data-need="config.patch" onClick={() => setEdit({ old: null, name: "", g: { type: "message.senders", members: {} } })}>New list</button></div>}
    <Hint>A list lets no one in by itself. Use it in “Who may message it” or a group’s list.</Hint>
  </>;
}

function ListEditor({ apps, cfg, start, onClose }: { apps: App[]; cfg: Cfg; start: { old: string | null; name: string; g: Group }; onClose: () => void }) {
  const [name, setName] = useState(start.name);
  const [g, setG] = useState<Group>(start.g);
  const [error, setError] = useState("");
  const [del, setDel] = useState(false);
  const old = start.old;
  const save = async () => {
    const n = name.trim();
    if (!n || n.includes(".")) { setError(n ? "A list name can’t have a full stop in it." : "Give the list a name."); return; }
    if (old && old !== n && !(await cfg.set("accessGroups." + old, null))) return;
    if (await cfg.set("accessGroups." + n, g)) onClose();
  };
  const remove = async () => { if (old && (await cfg.set("accessGroups." + old, null))) onClose(); };
  const entries: Entry[] = g.type === "message.senders" ? Object.entries(g.members).flatMap(([a, ids]) => ids.map((id): Entry => [a, id])) : [];
  const setEntries = (e: Entry[]) => { const members: Record<string, string[]> = {}; for (const [a, id] of e) (members[a] ??= []).push(id); setG({ type: "message.senders", members }); };
  return (
    <div className="r1-ca-editor" role="group" aria-label={old ? "Edit " + visible(old) : "New list"}>
      <Line label="Name" stack><Input label="Name" value={name} onSave={setName} /></Line>
      <Line label="Kind" stack><Segmented label="Kind" value={g.type} options={[{ v: "message.senders", label: "People I name" }, { v: "discord.channelAudience", label: "Everyone who can see a Discord channel" }]} onChange={(t) => setG(t === "message.senders" ? { type: "message.senders", members: {} } : { type: "discord.channelAudience", guildId: "", channelId: "" })} /></Line>
      {g.type === "discord.channelAudience" ? <>
        <Line label="Server ID"><Input label="Server ID" value={g.guildId} onSave={(v) => setG({ ...g, guildId: v })} /></Line>
        <Line label="Channel ID"><Input label="Channel ID" value={g.channelId} onSave={(v) => setG({ ...g, channelId: v })} /></Line>
      </> : <PeopleList apps={apps} entries={entries} every onChange={setEntries} ph="Their ID" />}
      <Alert text={error || cfg.error} />
      {del ? <div className="r1-ca-confirm" role="group" aria-label="Confirm delete"><p className="g-label" data-lines>Delete {visible(old)}? Places that use it stop letting those people in.</p><button type="button" data-local="" onClick={() => setDel(false)}>Cancel</button><button type="button" data-need="config.patch" onClick={() => void remove()}>Delete list</button></div> : null}
      <div className="r1-ca-acts">
        {old ? <button type="button" data-local="" onClick={() => setDel(true)}>Delete list</button> : null}
        <button type="button" data-local="" onClick={onClose}>Cancel</button>
        <button type="button" data-need="config.patch" disabled={!cfg.ready} onClick={() => void save()}>Save</button>
      </div>
    </div>
  );
}

/** Messages, every setting: every messages.* key by name, with Back to default (Classic chatapps-depth MsgKeys). */
function MsgKeys({ cfg }: { cfg: Cfg }) {
  return <>{MSG_KEYS.map(([key, what, above, def, kind, opts]) => {
    const v = cfg.get(key);
    return <Line key={key} label={<code>{key}</code>} help={what + " Default: " + def + "."} ctlNeed={above ? undefined : "config.patch"}>
      {above ? <span className="g-label">Set above in {above}</span> : <KeyInput k={key} kind={kind ?? "text"} opts={opts} v={v} cfg={cfg} />}
      {!above && v !== undefined ? <button type="button" disabled={!cfg.ready} onClick={() => void cfg.set(key, null)}>Back to default</button> : null}
    </Line>;
  })}</>;
}
function KeyInput({ k, kind, opts, v, cfg }: { k: string; kind: string; opts?: string[]; v: unknown; cfg: Cfg }) {
  const [bad, setBad] = useState(false);
  if (kind === "bool") return <Toggle label={k} on={v === true} disabled={!cfg.ready} onChange={(on) => void cfg.set(k, on)} />;
  if (kind === "select") return <select className="r1s-inp" aria-label={k} value={typeof v === "string" ? v : ""} disabled={!cfg.ready} onChange={(e) => void cfg.set(k, e.target.value || null)}><option value="">Not set</option>{(opts ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>;
  if (kind === "json") return <span className="r1-ca-json" aria-invalid={bad || undefined} title={bad ? "That isn’t a list like {\"telegram\": 500}." : undefined}>
    <Input label={k} value={v === undefined ? "" : JSON.stringify(v)} placeholder="{}" disabled={!cfg.ready} onSave={(s) => { if (!s.trim()) { setBad(false); void cfg.set(k, null); return; } try { const parsed: unknown = JSON.parse(s); setBad(false); void cfg.set(k, parsed); } catch { setBad(true); } }} />
  </span>;
  return <Input label={k} value={typeof v === "string" ? v : typeof v === "number" ? String(v) : ""} disabled={!cfg.ready} onSave={(s) => void cfg.set(k, s.trim() ? s : null)} />;
}

/** Each app, in depth: what only one app can do, saved to that app's own key once it is connected. */
function Depth({ ctx: { cfg, apps, all } }: { ctx: Ctx }) {
  const shown = all.filter((c) => DEPTH_APPS[c.id]);
  if (!shown.length) return <Hint>Each app’s own settings show here for the apps Branch has.</Hint>;
  return <>{shown.map((c) => {
    const on = apps.some((a) => a.id === c.id);
    const rows = DEPTH_APPS[c.id].map(({ key, ...r }): ClassicRow => (!key ? r : on ? { ...r, path: "channels." + c.id + "." + key } : { ...r, off: "Connect " + c.name + " first." }));
    return <details key={c.id} className="r1-ca-fold" open={on}>
      <summary className="g-frost"><ChatLogo id={c.id} name={c.name} size={24} /><span className="g-label"><b>{c.name}</b> · {rows.length} setting{rows.length > 1 ? "s" : ""}{on ? " · connected" : ""}</span></summary>
      {rows.map((r) => r.id === "join-huddles"
        ? <Line key={r.t} label={r.t} help={r.sub} ctlNeed="config.patch"><Toggle label={r.t} on={joinHuddlesOn(cfg.get)} disabled={!cfg.ready} onChange={(on) => void setJoinHuddles(cfg.set, on)} /></Line>
        : r.kind === "custom" ? <Line key={r.t} label={r.t} help={r.sub} coming={NO_KEY}><button type="button" disabled>{(r.id ?? "").slice(4)}</button></Line> : <KeyLine key={r.t} cfg={cfg} row={r} />)}
    </details>;
  })}</>;
}

/* ---------- Manage <app>, Advanced and Technical (Classic chatapps-manage-more) ---------- */

const HAS_NO = (name: string) => name + " has no setting for this.";
const EVERY: [string, unknown][] = [["As every app", undefined], ["On", true], ["Off", false]];
const GROUP_POL: [string, unknown][] = [["As every app", undefined], ["Groups I approve", "allowlist"], ["Any group", "open"], ["No groups", "disabled"]];
const SERVER: [string, string, string, boolean][] = [
  ["channelInfo", "Channel, event and voice info", "Look up channels, events and who is in voice.", true], ["events", "Create events", "", true],
  ["roles", "Change roles", "Off until you choose: it acts on people in your server.", false], ["moderation", "Moderate: time out, kick and ban", "Off until you choose: it acts on people in your server.", false],
  ["presence", "Set its own status", "Off until you choose: it acts on people in your server.", false],
];
const MODE_WORDS: Record<string, string> = { polling: "Polling", webhook: "Webhook", socket: "A live connection", websocket: "A live connection" };
const SECRET = /token|secret|password|key$|apiKey|privateKey|credential/i;

type AppMoreProps = { engine: WindowEngine; app: ChatApp; state: App; cfg: Cfg; level: Level; reload: () => Promise<void>; onSetup: () => void };
export function AppMore(p: AppMoreProps) {
  const ch = p.app.channel ?? p.app.id;
  const base = "channels." + ch;
  const lookup = useResource<RecordValue>(p.engine, "config.schema.lookup", { path: base });
  const props = record(record(lookup.data?.schema).properties);
  const children = list(lookup.data?.children);
  const keys = new Set([...children.map((c) => text(c.key)), ...Object.keys(props)]);
  const has = (k: string) => keys.has(k);
  const keyed = (r: ClassicRow, key: string): ClassicRow => (has(key) ? r : { ...r, path: undefined, off: HAS_NO(p.app.name) });
  const fields = useMemo(() => fieldsOf(children, props), [lookup.data]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="r1-ca-appmore">
      <h3 className="g-label">Commands</h3>
      <KeyLine cfg={p.cfg} row={keyed({ t: "Settings commands may save", sub: "Lets /config in " + p.app.name + " save changes, when Change settings is on.", kind: "sw", path: base + ".configWrites", def: true }, "configWrites")} />
      <KeyLine cfg={p.cfg} row={keyed({ t: "Commands in " + p.app.name + "’s menu", kind: "seg", path: base + ".commands.native", opts: EVERY }, "commands")} />
      <KeyLine cfg={p.cfg} row={keyed({ t: "Skills in " + p.app.name + "’s menu", kind: "seg", path: base + ".commands.nativeSkills", opts: EVERY }, "commands")} />
      <h3 className="g-label">Groups</h3>
      <Groups {...p} base={base} has={has} />
      <h3 className="g-label">How replies arrive</h3>
      <KeyLine cfg={p.cfg} row={{ t: "Long replies", sub: "Paragraph by paragraph, or one message at the end.", kind: "seg", opts: [["As every app", 0], ["In parts", 1], ["All at once", 2]], def: 0, off: "Long replies are set for every app, under How replies arrive." }} />
      {p.level >= 2 ? <KeyLine cfg={p.cfg} row={{ t: "Wait for more before sending", sub: "For " + p.app.name + " only.", kind: "num", unit: "ms", ph: "1000", off: "Branch has no setting for this per app yet." }} /> : null}
      {ch === "discord" ? <>
        <h3 className="g-label">In your server</h3>
        <Hint>What a Trunk can look up and add in your Discord server.</Hint>
        {SERVER.map(([k, t, s, def]) => <KeyLine key={k} cfg={p.cfg} row={{ t, sub: s || undefined, kind: "sw", def, ...(has("actions") ? { path: base + ".actions." + k } : { off: HAS_NO("Discord") }) }} />)}
      </> : null}
      <h3 className="g-label">Health</h3>
      <Health {...p} />
      {p.state.accounts.length ? <Accounts {...p} /> : null}
      {p.level >= 2 ? <AllSettings {...p} base={base} fields={fields} loading={lookup.loading} /> : null}
    </div>
  );
}

function Groups({ app, cfg, base, has }: AppMoreProps & { base: string; has: (k: string) => boolean }) {
  const [gid, setGid] = useState("");
  const own = cfg.get(base + ".groupPolicy");
  const eff = String(own ?? cfg.get("channels.defaults.groupPolicy") ?? "allowlist");
  const groups = Object.entries(record(cfg.get(base + ".groups"))).filter(([id]) => id !== "*");
  const add = () => { const v = gid.trim(); if (v && !v.includes(".")) { void cfg.set(base + ".groups." + v, {}); setGid(""); } };
  return <>
    <KeyLine cfg={cfg} row={{ t: "Groups it answers in", sub: eff === "open" ? "Any group still answers only when mentioned unless a group says otherwise." : "Groups not allowed here get no answer.", kind: "seg", opts: GROUP_POL, ...(has("groupPolicy") ? { path: base + ".groupPolicy" } : { off: HAS_NO(app.name) }) }} />
    {eff === "allowlist" && has("groups") ? <div className="r1-ca-editor" role="group" aria-label="Groups">
      {groups.map(([id, g]) => {
        const mention = record(g).requireMention !== false;
        return <div key={id} className="r1-ca-group-row">
          <span className="g-label" data-lines><b>{visible(id)}</b> · Answers when {mention ? "mentioned" : "every message"}</span>
          <span className="g-label">Allowed</span><Toggle label={"Allowed in " + id} on disabled={!cfg.ready} onChange={() => void cfg.set(base + ".groups." + id, null)} />
          <Segmented label={"Answers when in " + id} value={mention ? "m" : "e"} options={[{ v: "m", label: "Mentioned" }, { v: "e", label: "Every message" }]} disabled={!cfg.ready} onChange={(v) => void cfg.set(base + ".groups." + id + ".requireMention", v === "m")} />
          <select className="r1s-inp" aria-label={"Who in " + id} disabled title="Branch can’t limit who in a group yet." data-coming={NO_KEY}><option>Anyone</option></select>
        </div>;
      })}
      <div className="r1-ca-add"><input className="r1s-inp" placeholder="Group ID" aria-label="Group ID" value={gid} disabled={!cfg.ready} onChange={(e) => setGid(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} /><button type="button" disabled={!cfg.ready || !gid.trim()} data-need="config.patch" onClick={add}>Add a group by ID</button></div>
      <Hint>/activation mention or /activation always in a group changes its “Answers when”. Owners only.</Hint>
    </div> : null}
    <KeyLine cfg={cfg} row={{ t: "In groups", sub: "Every message it was let in for gets a reply.", kind: "seg", opts: [["Always answer", 0], ["May stay quiet", 1]], def: 0, off: NO_KEY }} />
  </>;
}

function Health({ engine, app, state, reload, onSetup }: AppMoreProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const a: Acct = state.accounts[0] ?? { accountId: "default" };
  const facts = ([["Started", ago(a.lastStartAt)], ["Last checked", ago(a.lastProbeAt)], ["Last message in", ago(a.lastInboundAt)], ["Receives by", a.mode ? MODE_WORDS[a.mode] ?? visible(a.mode) : ""]] as [string, string][]).filter(([, v]) => v);
  const check = async () => {
    setBusy(true); setError("");
    try { await requestOrComing(engine, "channels.status", { probe: true, channel: app.channel ?? app.id }); await reload(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return <>
    {facts.length ? <dl className="r1-ca-facts">{facts.map(([k, v]) => <div key={k}><dt className="g-label">{k}</dt><dd className="g-label">{v}</dd></div>)}</dl> : null}
    {a.lastError ? <p className="g-label" data-lines data-tone="bad">{visible(a.lastError)}</p> : null}
    <div className="r1-ca-acts">
      <button type="button" disabled={busy || !canAll(engine, ["channels.status"])} data-need="channels.status" onClick={() => void check()}>{busy ? "Checking…" : "Check now"}</button>
      <button type="button" disabled data-coming={"Branch has no help page for " + app.name + " yet."} title={"Branch has no help page for " + app.name + " yet."}>Help</button>
      <button type="button" data-local="setup" onClick={onSetup}>Set up again</button>
    </div>
    <Alert text={error} />
    <Hint>The status pill stays Online or Offline.</Hint>
  </>;
}

function Accounts({ app, state, onSetup }: AppMoreProps) {
  return <>
    <h3 className="g-label">Accounts</h3>
    {state.accounts.map((a) => { const tone = acctTone(a); return (
      <div key={a.accountId} className="r1-ca-app"><ChatLogo id={app.channel ?? app.id} name={app.name} size={24} /><span className="g-label" data-lines><b>{visible(a.name ?? a.accountId)}</b> <small>{acctLine(a, app.name)}</small></span><Pill tone={toneOf(tone)}>{PILL_WORDS[tone]}</Pill></div>
    ); })}
    <Hint>Each account follows “Who answers” unless the routing list gives it its own Trunk.</Hint>
    <div className="r1-ca-acts"><button type="button" data-need="wizard.start" onClick={onSetup}>Add another account</button></div>
  </>;
}

type Field = ReturnType<typeof fieldsOf>[number];
/** Every simple setting the app has, from its own schema; changes wait for Save, and Reload drops them. */
function AllSettings({ app, cfg, base, fields, loading }: AppMoreProps & { base: string; fields: Field[]; loading: boolean }) {
  const [draft, setDraft] = useState<RecordValue>({});
  const [more, setMore] = useState(false);
  const shown = more ? fields : fields.slice(0, 7);
  const val = (k: string) => (k in draft ? draft[k] : cfg.get(base + "." + k));
  const save = async () => { if (await cfg.set(base, draft)) setDraft({}); };
  return <>
    <h3 className="g-label">All settings</h3>
    <Hint>Every setting {app.name} has, from its own list of settings.</Hint>
    {loading ? <Hint>Reading its settings…</Hint> : null}
    {shown.map((f) => <Line key={f.key} label={<code>{base + "." + f.key}</code>}>{SECRET.test(f.key) ? <span className="g-label">Edit it in the settings file.</span> : <FieldInput f={f} value={val(f.key)} onChange={(v) => setDraft({ ...draft, [f.key]: v })} />}</Line>)}
    {fields.length > 7 ? <button type="button" className="r1s-link" data-local="" onClick={() => setMore(!more)}>{more ? "Show less" : "Show more"}</button> : null}
    <div className="r1-ca-acts"><button type="button" disabled={!cfg.ready || !Object.keys(draft).length} data-need="config.patch" onClick={() => void save()}>Save</button><button type="button" data-local="" onClick={() => setDraft({})}>Reload</button></div>
  </>;
}
function FieldInput({ f, value, onChange }: { f: Field; value: unknown; onChange: (v: unknown) => void }) {
  if (f.type === "boolean") return <select className="r1s-inp" aria-label={f.key} value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value === "true")}><option value="">Not set</option><option value="true">true</option><option value="false">false</option></select>;
  if (f.type === "enum") return <select className="r1s-inp" aria-label={f.key} value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value || null)}><option value="">Not set</option>{(f.opts ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>;
  const num = f.type === "integer" || f.type === "number";
  return <input className="r1s-inp" aria-label={f.key} type={num ? "number" : "text"} value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? null : num ? Number(e.target.value) : e.target.value)} />;
}
