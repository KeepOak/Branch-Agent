// Seedbank's pieces (preview item 28: .mkRowP17, .mkCardP17, .mkAddP17, .mkSeedP17, item 45 Adapters tiles, and the
// Coming to Branch tiles from R1-15).
import { type ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Face } from "../../face/Face";
import { Coming } from "../../glass/coming";
import { Glyph } from "../../places/customize/glyphs";
import { Icon } from "../../shell/icons";
import { kindOf, shortCount, type Entry } from "./catalog";
import { seedText } from "./seed";
import { UPCOMING, UPCOMING_COMING } from "./upcoming";
import { addCall } from "./useSeedbank";

/** A control Seedbank doesn't wire yet: drawn through <Coming unwired>, so it has the Coming look and reason, swallows
 *  every click, key and pointer event, and is listed by the call it waits for, even on an engine that offers it (R1-10). */
export function Soon({ need, reason, className, label, children }: { need: string; reason: string; className?: string; label?: string; children: ReactNode }) {
  const where = label ?? (typeof children === "string" ? children : need);
  return <Coming need={need} unwired reason={reason} where={where}><button type="button" className={className} aria-label={label}>{children}</button></Coming>;
}

const GLYPH = { skills: "bolt", mcp: "plug", plugins: "puzzle" } as const;
export function ItemIcon({ entry, size }: { entry: Entry; size: number }) {
  if (entry.source.type === "template") return <span className="sb-face" style={{ width: size, height: size }}><Face size={size} label={entry.name} pebbleLook={{ colour: entry.source.template.colour }} /></span>;
  const glyph = entry.kind === "skills" || entry.kind === "mcp" || entry.kind === "plugins" ? GLYPH[entry.kind] : null;
  return <span className="sb-tile" aria-hidden="true" style={{ width: size, height: size }}>{glyph ? <Glyph name={glyph} size={Math.round(size * 0.5)} /> : <Icon name="sun" size={Math.round(size * 0.5)} />}</span>;
}

export function Badges({ entry }: { entry: Entry }) {
  return <><span className="sb-badge" data-official={entry.badge === "Official" || undefined}>{entry.badge}</span>{entry.checked && <span className="sb-badge" data-checked="true">Checked</span>}</>;
}

/** Only numbers the catalog returned (Pitfall 14). Stars and copies come with ratings and uploads. */
export function Counts({ entry }: { entry: Entry }) {
  if (entry.downloads === undefined) return null;
  return <span className="sb-counts"><span aria-label={entry.downloads + " downloads"}>⬇ {shortCount(entry.downloads)}</span></span>;
}

export function AddPill({ entry, engine, onAdd }: { entry: Entry; engine: WindowEngine; onAdd: (entry: Entry) => void }) {
  if (entry.installed) return <span className="sb-added" aria-label={entry.name + (entry.inUse ? " is in use" : " is added")}>{entry.inUse ? "In use" : "Added ✓"}</span>;
  const call = addCall(entry);
  if (!call) return null;
  if ("reason" in call) return <Soon className="sb-add" need={entry.source.type === "template" ? "trunks.template.create" : "plugins.install"} reason={call.reason} label={"Add " + entry.name}>Add</Soon>;
  return <Coming engine={engine} need={call.method} reason={"Adding " + kindOf(entry.kind).one + "s comes in a later update."}><button type="button" className="sb-add" aria-label={"Add " + entry.name} onClick={() => onAdd(entry)}>Add</button></Coming>;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".seed";
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}
export function SeedIcons({ entry, onNotice }: { entry: Entry; onNotice: (text: string) => void }) {
  const text = seedText(entry);
  if (!text) return null;
  const copy = () => { void navigator.clipboard?.writeText(text).then(() => onNotice("Copied " + entry.name + "’s seed. Paste it anywhere in Branch."), () => onNotice("The seed couldn’t be copied.")); };
  return <span className="sb-seed" data-local="">
    <button type="button" className="sb-icon" aria-label={"Copy " + entry.name + "’s seed"} title="Copy seed" onClick={copy}><Icon name="copy" size={13} /></button>
    <button type="button" className="sb-icon" aria-label={"Download " + entry.name + "’s seed"} title="Download .seed" onClick={() => download(entry.name, text)}><Icon name="download" size={13} /></button>
  </span>;
}

type RowProps = { entry: Entry; engine: WindowEngine; onOpen: (entry: Entry) => void; onAdd: (entry: Entry) => void; onNotice: (text: string) => void };
export function Row({ entry, engine, onOpen, onAdd, onNotice }: RowProps) {
  return <div className="sb-row" data-testid="sb-row" data-id={entry.id}>
    <ItemIcon entry={entry} size={36} />
    <span className="sb-rt g-frost">
      <b><button type="button" className="sb-name" data-local="" onClick={() => onOpen(entry)}>{entry.name}</button> <small>by {entry.by}</small><Badges entry={entry} /></b>
      {entry.desc && <span className="sb-desc" title={entry.desc}>{entry.desc}</span>}
      <Counts entry={entry} />
    </span>
    <SeedIcons entry={entry} onNotice={onNotice} />
    <AddPill entry={entry} engine={engine} onAdd={onAdd} />
  </div>;
}

export function Card({ entry, engine, onOpen, onAdd, onNotice }: RowProps) {
  return <div className="sb-card" data-testid="sb-card">
    <ItemIcon entry={entry} size={52} />
    <b><button type="button" className="sb-name" data-local="" onClick={() => onOpen(entry)}>{entry.name}</button></b>
    <small className="g-label">by {entry.by} · {kindOf(entry.kind).one}</small>
    {entry.downloads !== undefined && <span className="g-label"><Counts entry={entry} /></span>}
    <span className="sb-card-acts"><SeedIcons entry={entry} onNotice={onNotice} /><AddPill entry={entry} engine={engine} onAdd={onAdd} /></span>
  </div>;
}

const ADAPTER_SLOTS = [
  { slot: "channel.*", name: "Chat apps", icon: "chat", what: "How Telegram, Discord and the others reply: length, tone, buttons, when to stay quiet." },
  { slot: "shell", name: "Whole window", icon: "monitor", what: "The whole Branch window: a different layout, or a whole OS for Branch." },
  { slot: "approvals", name: "Approvals", icon: "lock", what: "How Branch asks before it acts: what needs a yes, and how it asks." },
  { slot: "memory", name: "Memory", icon: "book", what: "What Branch keeps between conversations, and how it finds it again." },
  { slot: "scheduler", name: "Scheduler", icon: "clock", what: "When routines run, and what happens when the computer was asleep." },
  { slot: "look", name: "Look", icon: "sun", what: "How Branch looks beyond themes: type, spacing, motion." },
] as const;
export const ADAPTERS_COMING = "Adapters arrive after release.";

/** Item 45: six slot tiles, each "Using: Default" and Coming. No install buttons. */
export function Adapters({ brief }: { brief: boolean }) {
  return <>
    <p className="sb-lead g-label" data-lines>Change how any part of Branch behaves: swap how Telegram replies, or the whole window.{brief ? "" : " Each part has a slot; an adapter fills it, tried first in shadow, one tap to switch back, and it rolls back on its own if it misbehaves."}</p>
    <div className="sb-adapters">{(brief ? ADAPTER_SLOTS.slice(0, 3) : ADAPTER_SLOTS).map(a => <div key={a.slot} className="sb-card sb-adapter" role="group" aria-label={a.name + " adapter, coming"}>
      <span className="sb-tile" aria-hidden="true" style={{ width: 36, height: 36 }}><Icon name={a.icon} size={18} /></span>
      <b className="g-label">{a.name}</b><small className="sb-slot g-label">{a.slot}</small><p className="g-label" data-lines>{a.what}</p>
      <span className="sb-using g-label">Using: Default</span>
      <span className="sb-coming"><span className="sb-pill g-label">Coming</span><small className="g-label">{ADAPTERS_COMING}</small></span>
    </div>)}</div>
  </>;
}

/** R1-15: the features moved out of the main window until they work, one Coming tile each, drawn like the Adapters. No
 *  buttons; each tile still registers in the dev Coming list by the engine call it waits for. */
export function UpcomingFeatures({ brief }: { brief: boolean }) {
  return <>
    <p className="sb-lead g-label" data-lines>Features on their way into Branch, and where each one will live.{brief ? "" : " They show up in their place once the engine they need is ready."}</p>
    <div className="sb-adapters sb-upcoming">{(brief ? UPCOMING.slice(0, 3) : UPCOMING).map(u => <div key={u.id} className="sb-card sb-adapter" role="group" aria-label={u.name + ", coming"} data-need={u.need}>
      <Coming need={u.need} unwired hidden reason={UPCOMING_COMING} where={"Seedbank › Coming to Branch › " + u.name}><span /></Coming>
      <span className="sb-tile" aria-hidden="true" style={{ width: 36, height: 36 }}><Icon name={u.icon} size={18} /></span>
      <b className="g-label">{u.name}</b><small className="sb-slot g-label">{u.where}</small><p className="g-label" data-lines>{u.what}</p>
      <span className="sb-coming"><span className="sb-pill g-label">Coming</span><small className="g-label">{UPCOMING_COMING}</small></span>
    </div>)}</div>
  </>;
}
