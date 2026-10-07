// Settings › Chat apps: "Each app, in depth" (what only one app can do, for the apps the engine has, each saved to
// that app's own key in channels.<id>.*) and, at Technical, "Messages, every setting" (every messages.* key).
import { useState } from "react";
import { Btn, Ctl, Field, Pick, Switch, Val } from "../kit";
import { ChatLogo as Logo } from "./chatapps-logo";
import type { CatalogueApp } from "./chatapps-data";
import { KeyRow, NO_KEY, type Cfg, type Row } from "./chatapps-kit";

const off = (t: string, sub: string | undefined, kind: Row["kind"], def?: unknown, opts?: string[]): Row => ({ t, sub, kind, def, off: NO_KEY, ...(opts ? { opts: opts.map((l, i) => [l, i] as [string, unknown]) } : {}) });
const SCAN = "Instead of copying IDs and secrets.";
/** Each app's own rows, keyed by the engine's channel id; a row with `key` saves channels.<id>.<key>. */
const DEPTH: Record<string, (Row & { key?: string })[]> = {
  telegram: [
    { t: "Live typing", sub: "The reply appears as it is written, in one message that only notifies when done.", kind: "seg", key: "streaming.mode", opts: [["Off", "off"], ["One message", "partial"], ["Steps too", "progress"]] },
    off("Search commands with @bot", "Type @ and the bot’s name in any chat to find a command or skill.", "sw", true),
    off("Understand stickers", "A sticker is described once and remembered.", "sw", true),
    off("Spoken replies as voice bubbles", "Off until you choose: it sends voice notes into chats.", "sw", false),
    off("Reach Telegram another way when it’s blocked", "Tries Telegram’s known addresses when its usual one can’t be reached.", "sw", true),
    off("Large files as streaming links", "Files too big for the bot open as a link that streams from Telegram.", "sw", false),
    off("Read my own chats too", "Your personal account, read only, after a code and your two-step password. Off until you choose: it reads your own chats.", "sw", false),
  ],
  discord: [
    off("A thread for each task", "A message in a channel starts a thread named after the task; each thread is its own conversation.", "sw", true),
    { t: "Buttons, menus and forms", sub: "Replies can carry buttons and pick lists; what you press goes back to the Trunk.", kind: "sw", key: "agentComponents.enabled", def: true },
    off("Open a Trunk’s page inside Discord", "An “Open” button shows a page the Trunk made, after Discord sign-in. Off until you choose: it runs a page in Discord.", "sw", false),
    off("Roles that may message it", "One role or name per line. Empty: as “Who may message it”.", "lines"),
    off("Never ping everyone", "@everyone, @here and role pings are taken out of every reply.", "sw", true),
    { t: "Plural members", sub: "A message sent through PluralKit counts as the member who sent it.", kind: "sw", key: "pluralkit.enabled", def: false },
    off("Spoken replies as voice messages", "Off until you choose: it sends voice messages into chats.", "sw", false),
    { t: "Join voice channels", sub: "A Trunk can join, listen to each person and answer aloud. Off until you choose: it listens in voice channels.", kind: "sw", key: "voice.enabled", def: false },
    { t: "Use the Discord app on this computer", sub: "Without a bot: reads and answers through the Discord window.", kind: "custom", id: "btn:Set up" },
  ],
  slack: [
    off("Charts and tables as Slack blocks", "Tables and charts show as Slack’s own.", "sw", true),
    off("Read the thread first", "Pulled into a thread, it reads what was said before.", "sw", true),
    off("Reactions that start a task", "One emoji name per line, such as robot_face.", "lines"),
    off("Forms and shortcuts", "Slack’s forms and message shortcuts start a Trunk’s work.", "sw", true),
    off("Every workspace in your organisation", "For Slack Enterprise installs.", "sw", false),
    { t: "/branch and the Home tab", sub: "A Slack command that starts or steers a task, and a Home tab.", kind: "sw", key: "slashCommand.enabled", def: false },
    { t: "Post as me", sub: "Replies show your name and picture. Off until you choose: it speaks as you.", kind: "sw", key: "postAs", vals: ["user", "bot"], def: "bot" },
    off("Say hello when someone comes online", "One short greeting, at most once a week each. Off until you choose: it messages people first.", "sw", false),
    off("Slack events start automations", "Joins, new channels and reactions can start an automation.", "sw", false),
    off("Slack apps", "One per Trunk gives each its own name and picture in Slack; setup makes them.", "seg", 0, ["One for all Trunks", "One per Trunk"]),
  ],
  whatsapp: [off("Call me on WhatsApp", "A Trunk can ring you and say a short message. Off until you choose: it places calls.", "sw", false)],
  imessage: [
    off("Connect through", "A Mac of your own, a BlueBubbles server on a Mac, or a hosted relay.", "seg", 0, ["This Mac", "BlueBubbles", "A hosted relay"]),
    off("Tapbacks, effects and polls", "Replies can react, thread and ask with a poll.", "sw", true),
    off("Approvals as a poll", "You answer an approval with a vote or a tapback.", "sw", true),
  ],
  matrix: [
    { t: "Verify this device", sub: "Encrypted rooms need this device verified once.", kind: "custom", id: "btn:Verify" },
    off("Each thread its own conversation", undefined, "sw", true),
    { t: "Accept room invites", kind: "seg", key: "autoJoin", opts: [["From people I approve", "allowlist"], ["From anyone", "always"], ["Never", "off"]] },
  ],
  msteams: [
    off("Signs in with", "How the Teams bot proves who it is.", "seg", 0, ["App secret", "Certificate", "Managed identity"]),
    off("Post meeting notes to Teams", "Notes from a Teams meeting go to its chat.", "sw", false),
  ],
  googlechat: [{ t: "Send files as you", sub: "Each person signs in once so files arrive as real attachments.", kind: "custom", id: "btn:Sign in" }],
  feishu: [
    { t: "Make the app by scanning a code", sub: SCAN, kind: "custom", id: "btn:Show the code" },
    off("Answer comments on documents", "A comment that mentions the bot on a Feishu doc starts a task; the answer goes in the thread.", "sw", false),
    off("Docs, Drive and Wiki", "A Trunk can write and edit Feishu docs and work with Drive, Wiki and sharing.", "sw", false),
    off("Meeting invitations", "An invitation becomes a message, so the answer reaches whoever invited it.", "sw", true),
    off("Unsending a message stops its task", undefined, "sw", true),
  ],
  line: [off("Use free replies first", "A slow answer waits behind a button, so it doesn’t cost a paid message.", "sw", true)],
  zalo: [off("Connect as", undefined, "seg", 0, ["A bot", "My personal account"])],
  sms: [off("Send texts through", undefined, "seg", 0, ["Twilio", "An Android phone"])],
};
export const DEPTH_TITLES = Object.values(DEPTH).flat().map((r) => r.t);

export function Depth({ catalogue, connected, cfg }: { catalogue: CatalogueApp[]; connected: Set<string>; cfg: Cfg }) {
  const apps = catalogue.filter((c) => DEPTH[c.id]);
  return <>{apps.map((c) => {
    const on = connected.has(c.id);
    const rows = DEPTH[c.id].map(({ key, ...r }): Row => (!key ? r : on ? { ...r, path: `channels.${c.id}.${key}` } : { ...r, off: `Connect ${c.name} first.` }));
    return (
      <details key={c.id} className="fold-ca" open={connected.has(c.id)}>
        <summary><Logo id={c.id} name={c.name} size={26} /><span className="grow"><b>{c.name}</b><small>{`${rows.length} setting${rows.length > 1 ? "s" : ""}${connected.has(c.id) ? " · connected" : ""}`}</small></span></summary>
        {rows.map((r) => r.kind === "custom" ? <Ctl key={r.t} title={r.t} sub={r.sub} off={NO_KEY}><Btn sm disabled>{(r.id ?? "").slice(4)}</Btn></Ctl> : <KeyRow key={r.t} row={r} cfg={cfg} />)}
      </details>
    );
  })}</>;
}

/** messages.* by key: [key, what it does, the section above that sets it, the default, how to edit it here]. */
const MSG_KEYS: [string, string, string | null, string, ("text" | "number" | "select" | "json" | "bool")?, string[]?][] = [
  ["messages.visibleReplies", "Whether each answer posts by itself.", null, "\"automatic\"", "select", ["automatic", "message_tool"]],
  ["messages.responsePrefix", "Text put before every reply.", "How replies are sent", "not set"],
  ["messages.usageTemplate", "The wording of the usage line under a reply.", null, "not set", "text"],
  ["messages.responseUsage", "Usage under each reply.", "How replies are sent", "\"off\""],
  ["messages.groupChat.mentionPatterns", "Names that wake it in a group.", "Groups", "[]"],
  ["messages.groupChat.historyLimit", "Earlier messages it reads in a group.", "Groups", "50"],
  ["messages.groupChat.unmentionedInbound", "How a group message that doesn’t mention it is treated: as a request, or as something that happened in the room.", null, "not set", "select", ["user_request", "room_event"]],
  ["messages.groupChat.visibleReplies", "Replies in groups.", "How replies are sent", "as messages.visibleReplies"],
  ["messages.queue.mode", "Messages sent while it works.", "How replies are sent", "\"steer\""],
  ["messages.queue.byChannel", "The same, per app.", "How replies are sent", "{}"],
  ["messages.queue.debounceMsByChannel", "How long to wait for more messages, per app, before they join the task.", null, "{}", "json"],
  ["messages.queue.cap", "Hold up to.", "How replies are sent", "20"],
  ["messages.queue.drop", "What happens when too many wait.", "How replies are sent", "\"summarize\""],
  ["messages.inbound.debounceMs", "Joins messages that arrive close together into one, in milliseconds.", "What the Trunk sees", "not set"],
  ["messages.inbound.byChannel", "The same, per app.", null, "{}", "json"],
  ["messages.ackReaction", "The reaction that acknowledges a message.", "How replies are sent", "the Trunk’s own emoji, or eyes"],
  ["messages.ackReactionScope", "Where it acknowledges with a reaction.", "How replies are sent", "\"group-mentions\""],
  ["messages.statusReactions.enabled", "Show progress as reactions.", null, "Discord on, others off", "bool"],
];

export const MSG_KEY_TITLES = MSG_KEYS.map(([key]) => key);

export function MsgKeys({ cfg }: { cfg: Cfg }) {
  return <>{MSG_KEYS.map(([key, what, above, def, kind, opts]) => {
    const v = cfg.get(key);
    return (
      <Ctl key={key} title={key} sub={`${what} Default: ${def}.`}>
        {above ? <Val>Set above in {above}</Val> : <KeyInput k={key} kind={kind ?? "text"} opts={opts} v={v} cfg={cfg} />}
        {!above && v !== undefined ? <Btn ghost sm onClick={() => void cfg.set(key, null)}>Back to default</Btn> : null}
      </Ctl>
    );
  })}</>;
}

function KeyInput({ k, kind, opts, v, cfg }: { k: string; kind: string; opts?: string[]; v: unknown; cfg: Cfg }) {
  const [bad, setBad] = useState(false);
  if (kind === "bool") return <Switch checked={v === true} label={k} disabled={cfg.loading} onChange={(on) => void cfg.set(k, on)} />;
  if (kind === "select") return <Pick label={k} value={typeof v === "string" ? v : ""} disabled={cfg.loading} options={[{ id: "", label: "Not set" }, ...(opts ?? []).map((o) => ({ id: o, label: o }))]} onChange={(o) => void cfg.set(k, o || null)} />;
  if (kind === "json") return (
    <span aria-invalid={bad || undefined} title={bad ? "That isn’t a list like {\"telegram\": 500}." : undefined}>
      <Field wide label={k} value={v === undefined ? "" : JSON.stringify(v)} placeholder="{}" disabled={cfg.loading} onCommit={(s) => { if (!s.trim()) { setBad(false); void cfg.set(k, null); return; } try { const parsed: unknown = JSON.parse(s); setBad(false); void cfg.set(k, parsed); } catch { setBad(true); } }} />
    </span>
  );
  return <Field wide label={k} value={typeof v === "string" ? v : typeof v === "number" ? String(v) : ""} disabled={cfg.loading} onCommit={(s) => void cfg.set(k, s.trim() ? s : null)} />;
}
