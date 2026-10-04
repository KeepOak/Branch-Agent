// Settings › Chat apps: the rows of the Advanced and Technical tables that read engine data (each connected app's
// watchdog, per-app reply queue, formatting) or that the engine has no key for, drawn greyed with why.
import { Btn, Ctl, Hint, Pick, Pill, Plist, Prow, Seg, Switch, Val } from "../kit";
import { ChatLogo as Logo } from "./chatapps-logo";
import { acctTone, ago, PILL_WORDS, type App, type CatalogueApp } from "./chatapps-data";
import { KeyRow, NO_KEY, type Cfg, type Row } from "./chatapps-kit";
import { CMD_OFF, CMD_WHO, QUEUE_MODES } from "./chatapps-tables";

type Ctx = { apps: App[]; cfg: Cfg; all?: CatalogueApp[] };
/** The app surfaces messages.queue.byChannel accepts (engine zod-schema.messages.ts QueueModeBySurfaceSchema). */
const QUEUE_SURFACES = new Set(["whatsapp", "telegram", "discord", "irc", "googlechat", "slack", "mattermost", "signal", "imessage", "msteams", "webchat", "matrix"]);

/** healthMonitor.enabled on every connected app (on unless an app turns it off). */
function Watch({ apps, cfg }: Ctx) {
  const on = apps.length > 0 && apps.every((a) => cfg.get(`channels.${a.id}.healthMonitor.enabled`) !== false);
  const set = (v: boolean) => { for (const a of apps) void cfg.set(`channels.${a.id}.healthMonitor.enabled`, v ? null : false); };
  const sub = "If no update arrives for a while, Branch reconnects it and tells you if that fails.";
  return (
    <Ctl title="Watch for a chat app that stops receiving" sub={!apps.length ? `${sub} Turns on with your first chat app.` : on ? `${sub} On because a chat app is connected.` : sub}>
      <Switch checked={on} label="Watch for a chat app that stops receiving" disabled={!apps.length || cfg.loading} onChange={set} />
    </Ctl>
  );
}

function Watchdog({ apps }: Ctx) {
  if (!apps.length) return null;
  return (
    <div className="rows">
      {apps.map((a) => {
        const m = a.accounts[0];
        const tone = m ? acctTone(m) : a.tone;
        const line = !m || tone === "bad" ? `Watchdog: stopped${m?.lastError ? ` · ${a.sub}` : ""}` : `Watchdog: last update ${ago(m.lastTransportActivityAt ?? m.lastInboundAt) || "not yet"} · reconnected ${m.reconnectAttempts ?? 0} times`;
        return <div key={a.id} className="prow"><Logo id={a.id} name={a.name} size={24} /><span className="grow"><b>{a.name}</b><small>{line}</small></span><Pill tone={tone === "ok" ? "ok" : tone === "work" ? "work" : "bad"}>{PILL_WORDS[tone]}</Pill></div>;
      })}
    </div>
  );
}

export const NATIVE: Record<string, string> = { telegram: "MarkdownV2", discord: "Markdown", slack: "Slack mrkdwn", whatsapp: "WhatsApp styles", matrix: "HTML", signal: "Signal styles" };
/** Each connected app, then the engine's other apps that have their own formatting, marked "(when connected)". */
function Formatting({ apps, all = [] }: Ctx) {
  const later = all.filter((c) => NATIVE[c.id] && !apps.some((a) => a.id === c.id));
  const rows = [...apps.map((a) => ({ id: a.id, name: a.name, on: true })), ...later.map((c) => ({ id: c.id, name: c.name, on: false }))];
  if (!rows.length) return <Hint>Each app’s formatting shows here once it is connected.</Hint>;
  return <>{rows.map((a) => (
    <Ctl key={a.id} id={a.name} title={a.on ? a.name : <>{a.name} <small className="when-ca">(when connected)</small></>} sub={`Bold, lists and links are turned into what ${a.name} shows.`} off="Each app’s own formatting is always used.">
      <Seg label={`Formatting in ${a.name}`} value="own" options={[{ id: "own", label: NATIVE[a.id] ?? "Its own styles" }, { id: "plain", label: "Plain text" }]} disabled onChange={() => undefined} />
    </Ctl>
  ))}</>;
}

function QueueByApp({ apps, cfg }: Ctx) {
  if (!apps.length) return null;
  const opts: [string, unknown][] = [["As above", undefined], ...QUEUE_MODES];
  return (
    <>
      <Hint>Per app</Hint>
      {apps.map((a) => <KeyRow key={a.id} cfg={cfg} row={{ t: a.name, kind: "pick", opts, ...(QUEUE_SURFACES.has(a.id) ? { path: `messages.queue.byChannel.${a.id}` } : { off: `${a.name} follows the choice above.` }) }} />)}
    </>
  );
}

const PROGRESS_APPS = ["Slack", "Discord", "Signal", "Telegram", "WhatsApp"];
function Progress({ cfg }: Ctx) {
  const on = cfg.get("messages.statusReactions.enabled");
  return (
    <Ctl title="Show progress as reactions" sub="The reaction on your message changes as the Trunk works and finishes. Slack keeps its own “is thinking” status as well. Off in Slack, Signal, Telegram and WhatsApp until you choose: it adds reactions to every message." off="Branch has one switch for every app (Technical › messages.statusReactions.enabled).">
      <span className="chips-ca">{PROGRESS_APPS.map((n) => <button key={n} type="button" className="chip-ca" aria-pressed={n === "Discord" ? on !== false : on === true} disabled>{n}</button>)}</span>
    </Ctl>
  );
}

/** A shortest/longest pause, only while "Pause between parts" is Custom. */
function Delay({ cfg, which }: Ctx & { which: "minMs" | "maxMs" }) {
  if (cfg.get("agents.defaults.humanDelay.mode") !== "custom") return null;
  const row: Row = { t: which === "minMs" ? "Shortest" : "Longest", path: `agents.defaults.humanDelay.${which}`, kind: "num", unit: "ms", def: which === "minMs" ? 800 : 2500 };
  return <KeyRow cfg={cfg} row={row} />;
}

/** Who may use each command, as the preview's list; the engine has one setting for every command, so each is greyed. */
function CmdRows() {
  const rows: [string, number][] = [["/new and /stop", 0], ["/model", 0], ["/config", 1], ["/approve", 0]];
  return (
    <>
      <Plist>{rows.map(([t, def]) => (
        <Prow key={t} title={<code>{t}</code>}>
          <span title={CMD_OFF}><Pick label={`Who may use ${t}`} value={String(def)} disabled options={CMD_WHO.map((label, i) => ({ id: String(i), label }))} onChange={() => undefined} /></span>
        </Prow>
      ))}</Plist>
      <Hint>{CMD_OFF}</Hint>
    </>
  );
}

/** Rows with a fixed control the engine can't act on yet, drawn greyed. */
function Greyed({ id }: { id: string }) {
  const off = NO_KEY;
  if (id === "slackFile") return <Ctl title="Slack app file" sub="Every Branch command becomes a Slack command." off="Branch can’t make a Slack app file yet."><Btn sm disabled>Make it</Btn></Ctl>;
  if (id === "watchLog") return <Ctl title="Watchdog log" sub="One line each time it checks or reconnects." off="Branch can’t show where the engine writes it yet." />;
  if (id === "updates") return <Ctl title="Stays connected through updates" sub="Chat apps keep running while Branch updates." off="Branch can’t tell yet whether an update keeps them running."><Pill tone="idle">Not known</Pill></Ctl>;
  if (id === "relay") return <Ctl title="A relay sends only to chats it knows" sub="Messages through a relay go only to chats Branch has heard from." off="Branch can’t tell yet how a relay sends." ><Pill tone="idle">Not known</Pill></Ctl>;
  if (id === "muted") return <Ctl title="Muted chats" sub="A muted chat is read but not answered." off={off}><Pick label="Chat to mute" value="" disabled options={[{ id: "", label: "Choose a chat" }]} onChange={() => undefined} /><Pick label="For how long" value="1" disabled options={[{ id: "1", label: "1 hour" }, { id: "t", label: "Until tomorrow" }, { id: "u", label: "Until I unmute it" }]} onChange={() => undefined} /><Btn sm disabled>Mute</Btn></Ctl>;
  if (id === "takeover") return <Ctl title="Take over a chat" sub="While you answer a chat yourself, the Trunk stays quiet there." off={off}><Btn ghost sm disabled>Take over</Btn></Ctl>;
  if (id === "forward") return <Ctl title="Forward between chats" sub="Copy messages from one chat to another, from now on, through your filters." off={off}><Btn sm disabled>Add a rule</Btn></Ctl>;
  if (id === "ownCmds") return <Ctl title="Your own commands" sub="A word that answers with your text, in any chat. Owners only." off="Only Telegram has its own commands, on its page."><Btn sm disabled>Add a command</Btn></Ctl>;
  return null;
}

/** A command or line to copy, shown as code. */
function Code({ title, sub, code }: { title: string; sub?: string; code: string }) {
  return <Ctl title={title} sub={sub}><Val code>{code}</Val></Ctl>;
}

/** Draws one custom table row by its id. */
export function partFor(id: string, ctx: Ctx, row?: Row) {
  if (id.startsWith("code:")) return <Code title={row?.t ?? ""} sub={row?.sub} code={id.slice(5)} />;
  if (id === "watch") return <Watch {...ctx} />;
  if (id === "cmdRows") return <CmdRows />;
  if (id === "watchdog") return <Watchdog {...ctx} />;
  if (id === "formatting") return <Formatting {...ctx} />;
  if (id === "queueByApp") return <QueueByApp {...ctx} />;
  if (id === "progress") return <Progress {...ctx} />;
  if (id === "delayMin") return <Delay {...ctx} which="minMs" />;
  if (id === "delayMax") return <Delay {...ctx} which="maxMs" />;
  return <Greyed id={id} />;
}
