// Seedbank's pieces (preview item 28: .mkRowP17, .mkCardP17, .mkAddP17, .mkSeedP17, and item 45 Adapters tiles).
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Face } from "../../face/Face";
import { Coming } from "../../glass/coming";
import { AppLogo } from "../../places/customize/app-logos";
import { Glyph } from "../../places/customize/glyphs";
import { useLevel } from "../../places-nav/level";
import { writeClipboard } from "../../shell/clipboard";
import { Icon } from "../../shell/icons";
import { plainError } from "../../shell/plain-error";
import { kindOf, shortCount, type Entry } from "./catalog";
import { ItemDetail } from "./ItemDetail";
import { seedLink, seedText } from "./seed";
import { addCall } from "./useSeedbank";

/** Whether Seedbank draws its Coming controls: only at Technical (settings rows.ts COMING_FROM, Private #1093 item 4).
 *  Seedbank provides it from the person's level; below Technical a Coming control is not drawn, and it is still listed
 *  by the call it waits for. Null when no Seedbank is around it: useTechnical then reads the saved level. */
export const ComingShown = createContext<boolean | null>(null);

/** Coming controls and their later-update lines show only at Technical; Regular and Advanced leave them out (R1-10).
 *  The one switch for every Seedbank piece. */
export function useTechnical(): boolean {
  const provided = useContext(ComingShown);
  const level = useLevel();
  return provided ?? level === "technical";
}

/** A control Seedbank doesn't wire yet: drawn through <Coming unwired>, so it has the Coming look and reason, swallows
 *  every click, key and pointer event, and is listed by the call it waits for, even on an engine that offers it (R1-10). */
export function Soon({ need, reason, className, label, children }: { need: string; reason: string; className?: string; label?: string; children: ReactNode }) {
  const shown = useTechnical();
  const where = label ?? (typeof children === "string" ? children : need);
  return <Coming need={need} unwired reason={reason} where={where} hidden={!shown}><button type="button" className={className} aria-label={label}>{children}</button></Coming>;
}

const GLYPH = { skills: "bolt", plugins: "puzzle" } as const;
export function ItemIcon({ entry, size }: { entry: Entry; size: number }) {
  if (entry.source.type === "template") return <span className="sb-face" style={{ width: size, height: size }}><Face size={size} label={entry.name} pebbleLook={{ colour: entry.source.template.colour }} /></span>;
  if (entry.kind === "mcp") return <AppLogo name={entry.name} size={size} />;   /* A-141: the app's logo, or a monogram tile */
  const glyph = entry.kind === "skills" || entry.kind === "plugins" ? GLYPH[entry.kind] : null;
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

export function AddPill({ entry, engine, onAdd, text = "Add" }: { entry: Entry; engine: WindowEngine; onAdd: (entry: Entry) => void; text?: string }) {
  const technical = useTechnical();
  if (entry.installed) return <span className="sb-added" aria-label={entry.name + (entry.inUse ? " is in use" : " is added")}>{entry.inUse ? "In use" : "Added ✓"}</span>;
  const call = addCall(entry);
  if (!call) return null;
  // Soon reads the same switch: below Technical it draws nothing and stays listed by the call it waits for.
  if ("reason" in call) return <Soon className="sb-add" need={entry.source.type === "template" ? "trunks.template.create" : "plugins.install"} reason={call.reason} label={"Add " + entry.name}>{text}</Soon>;
  return <Coming engine={engine} need={call.method} hidden={!technical} reason={"Adding " + kindOf(entry.kind).one + "s comes in a later update."}><button type="button" className="sb-add" aria-label={"Add " + entry.name} onClick={() => onAdd(entry)}>{text}</button></Coming>;
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".seed";
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}
export const SEED_COMING = "Sharing this kind as a seed comes in a later update.";
/** Copy failed after the window clipboard and the Branch app clipboard: one plain sentence and a next step. */
export const SEED_NOT_COPIED = "The seed couldn’t be copied. Select it and copy it yourself.";
type Notice = (text: ReactNode) => void;
/** The seed selected, plus Try again, after Copy fails. */
function SeedCopyFailed({ link, name, onRetry }: { link: string; name: string; onRetry: () => void }) {
  const field = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const input = field.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [link]);
  return <>
    {plainError(SEED_NOT_COPIED)}{" "}
    <input ref={field} className="sb-seed-link g-frost" readOnly data-local="" value={link} aria-label={name + "’s seed"} onFocus={(e) => e.currentTarget.select()} />
    {" "}
    <button type="button" data-local="" onClick={onRetry}>Try again</button>
  </>;
}
/** Copy seed (a short link) and Download (.seed) on every card (preview seedIcons). A kind with no seed yet shows both
 *  as Coming at Technical, and none at Regular and Advanced. The window clipboard is tried first; when it is refused
 *  the Branch app clipboard is used. If both fail, the notice shows the seed selected with Try again. */
export function SeedIcons({ entry, onNotice }: { entry: Entry; onNotice: Notice }) {
  const technical = useTechnical();
  const text = seedText(entry), link = seedLink(entry);
  if (!text || !link) return !technical ? null : <span className="sb-seed">
    <Soon className="sb-icon" need="seedbank.seed" reason={SEED_COMING} label={"Copy " + entry.name + "’s seed"}><Icon name="copy" size={13} /></Soon>
    <Soon className="sb-icon" need="seedbank.seed" reason={SEED_COMING} label={"Download " + entry.name + "’s seed"}><Icon name="download" size={13} /></Soon>
  </span>;
  const copy = () => {
    void writeClipboard(link).then((ok) => {
      if (ok) {
        onNotice("Copied " + entry.name + "’s seed. Paste it anywhere in Branch.");
        return;
      }
      onNotice(<SeedCopyFailed link={link} name={entry.name} onRetry={copy} />);
    });
  };
  return <span className="sb-seed" data-local="">
    <button type="button" className="sb-icon" aria-label={"Copy " + entry.name + "’s seed"} title="Copy seed" onClick={copy}><Icon name="copy" size={13} /></button>
    <button type="button" className="sb-icon" aria-label={"Download " + entry.name + "’s seed"} title="Download .seed" onClick={() => download(entry.name, text)}><Icon name="download" size={13} /></button>
  </span>;
}

type RowProps = { entry: Entry; engine: WindowEngine; onOpen: (entry: Entry) => void; onAdd: (entry: Entry) => void; onNotice: Notice };
/** The item dialog for a card or row whose name was clicked. */
function useItemDialog(p: RowProps) {
  const [open, setOpen] = useState(false);
  return { show: () => setOpen(true), dialog: open ? <ItemDetail entry={p.entry} engine={p.engine} onClose={() => setOpen(false)} onAdd={p.onAdd} /> : null };
}
export function Row(props: RowProps) {
  const { entry, engine, onAdd, onNotice } = props;
  const item = useItemDialog(props);
  return <div className="sb-row" data-testid="sb-row" data-id={entry.id}>
    <ItemIcon entry={entry} size={36} />
    <span className="sb-rt g-frost">
      <b><button type="button" className="sb-name" data-local="" onClick={item.show}>{entry.name}</button> <small>by {entry.by}</small><Badges entry={entry} /></b>
      {entry.desc && <span className="sb-desc" title={entry.desc}>{entry.desc}</span>}
      <Counts entry={entry} />
    </span>
    <SeedIcons entry={entry} onNotice={onNotice} />
    <AddPill entry={entry} engine={engine} onAdd={onAdd} />
    {item.dialog}
  </div>;
}

export function Card(props: RowProps) {
  const { entry, engine, onAdd, onNotice } = props;
  const item = useItemDialog(props);
  return <div className="sb-card" data-testid="sb-card">
    <ItemIcon entry={entry} size={52} />
    <b><button type="button" className="sb-name" data-local="" onClick={item.show}>{entry.name}</button></b>
    <small className="g-label">by {entry.by} · {kindOf(entry.kind).one}</small>
    {entry.downloads !== undefined && <span className="g-label"><Counts entry={entry} /></span>}
    <span className="sb-card-acts"><SeedIcons entry={entry} onNotice={onNotice} /><AddPill entry={entry} engine={engine} onAdd={onAdd} /></span>
    {item.dialog}
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
