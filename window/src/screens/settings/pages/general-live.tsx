// Settings › General: the controls the R1 page draws itself (slots.ts controls). Each reuses Classic General's own logic on
// the same calls (places/settings/set1/general*.tsx, pins.ts) or Classic Advanced's window (advanced-tech.tsx): the rows
// you pinned (users.prefs "ui.window.look" pins), your projects (projects.list, each counted with sessions.list), Keyboard
// shortcuts (the shortcuts window), All conversations (the table on sessions.list) and the model for summaries
// (agents.defaults.compaction.model from models.list). The preview's buttons with nothing behind them yet are Coming.
import { useState, useSyncExternalStore } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Coming } from "../../../glass/coming";
import { configStore } from "../../../places/settings/config-store";
import { list, record, text, visible, type RecordValue } from "../../../places/settings/adapter";
import { useResource } from "../../../places/settings/hooks";
import { KitProvider } from "../../../places/settings/kit";
import { pinsOf, type Pin } from "../../../places/settings/pins";
import { lookStore } from "../../../places/settings/set1/appearance-store";
import { ConvDialog } from "../../../places/settings/set2/advanced-tech";
import { ShortcutsDialog } from "../../../shell/ShortcutsDialog";
import { onMac, shownInline } from "../../../shell/keymap";
import { pageFor } from "../nav";
import { COMING_FROM } from "../rows";
import { useLevel } from "../SettingsFrame";
import type { PageSlot, SlotControl, SlotControlProps } from "../slots";
import { Failed, Needs, useFailure } from "./appearance-live";

const QUIET = { saving: () => undefined, saved: () => undefined, failed: () => undefined };

/** The person's pinned rows (Classic's pins: [page, row title, level]). */
export function usePinned(engine: WindowEngine): [Pin[], (next: Pin[]) => Promise<void>] {
  const store = lookStore(engine);
  const look = useSyncExternalStore((fn) => store.subscribe(fn), () => store.snap.look, () => store.snap.look);
  return [pinsOf(look), (next) => store.set("pins", next.length ? next : null)];
}

/** Pinned: each pinned row with Go to it (its page) and Unpin, as the preview's Pinned card. */
export function PinnedList({ engine, onPage }: SlotControlProps) {
  const [pins, put] = usePinned(engine);
  const [failed, run] = useFailure();
  return <div className="r1s-items">
    {pins.map((pin) => (
      <div key={`${pin[0]}:${pin[1]}`} className="r1s-row" data-pin={pin[1]}>
        <b className="g-label">{visible(pin[1])}</b>
        <div className="r1s-ctl"><span className="r1s-acts">
          <button type="button" className="r1s-btn" data-local="" onClick={() => onPage?.(pageFor(pin[0]))}>Go to it</button>
          <Needs engine={engine} need={["users.prefs.set"]} where={`Unpin ${pin[1]}`}>
            <button type="button" className="r1s-btn" onClick={() => void run(() => put(pins.filter((p) => !(p[0] === pin[0] && p[1] === pin[1]))))}>Unpin</button>
          </Needs>
        </span></div>
      </div>
    ))}
    <Failed text={failed} />
  </div>;
}

type Project = { id: string; displayName: string };
/** One project: its name, how many conversations it has, and Edit (its own instructions, Coming). Like every Coming
 *  control, Edit shows only at Technical (rows.ts COMING_FROM): Regular and Advanced show only what works today. */
function ProjectRow({ engine, project }: { engine: WindowEngine; project: Project }) {
  const [level] = useLevel(engine);
  const res = useResource<RecordValue>(engine, "sessions.list", { projectId: project.id, limit: 1, excludeSubagents: true, excludeCron: true });
  const total = record(res.data).totalCount;
  return (
    <div className="r1s-row" data-project={project.id}>
      <b className="g-label">{visible(project.displayName)}</b>
      {typeof total === "number" ? <small className="g-label">{total} {total === 1 ? "conversation" : "conversations"}</small> : null}
      {level >= COMING_FROM ? <div className="r1s-ctl">
        <Coming engine={engine} need="engine: a project's own instructions" unwired reason="Editing a project’s own instructions comes in a later update.">
          <button type="button" className="r1s-btn">Edit</button>
        </Coming>
      </div> : null}
    </div>
  );
}

/** Projects: every project (projects.list), as the preview lists them. */
export function ProjectList({ engine }: SlotControlProps) {
  const res = useResource<RecordValue>(engine, "projects.list", {});
  const projects = list(res.data?.projects).map((p) => ({ id: text(p.id), displayName: text(p.displayName) || text(p.id) })).filter((p) => p.id);
  if (res.error) return <small className="r1s-msg r1s-bad g-label" role="status">{visible(res.error)}</small>;
  return <div className="r1s-items" data-need="projects.list">{projects.map((p) => <ProjectRow key={p.id} engine={engine} project={p} />)}</div>;
}

/** Keyboard shortcuts › Show all: the shortcuts window. */
export function KeyboardShortcuts(_: SlotControlProps) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="r1s-btn" data-local="" onClick={() => setOpen(true)}>Show all</button>
    {open ? <ShortcutsDialog onClose={() => setOpen(false)} /> : null}
  </>;
}

/** All conversations › Open the table: Classic Advanced's table of every conversation (sessions.list). */
export function AllConversations({ engine }: SlotControlProps) {
  const [open, setOpen] = useState(false);
  const [level] = useLevel(engine);
  return <>
    <Needs engine={engine} need={["sessions.list"]} where="Open the table">
      <button type="button" className="r1s-btn" onClick={() => setOpen(true)}>Open the table</button>
    </Needs>
    {open ? <KitProvider level={level} report={QUIET} scope={null}><ConvDialog engine={engine} lv={level} onClose={() => setOpen(false)} /></KitProvider> : null}
  </>;
}

/** Model for summaries: the conversation's model, or one from models.list (agents.defaults.compaction.model). */
export function SummaryModel({ engine, row }: SlotControlProps) {
  const store = configStore(engine);
  const snap = useSyncExternalStore((fn) => store.subscribe(fn), () => store.snap, () => store.snap);
  const models = useResource<RecordValue>(engine, "models.list", {});
  const [failed, run] = useFailure();
  const value = text(record(record(record(snap?.config).agents).defaults).compaction && record(record(record(record(snap?.config).agents).defaults).compaction).model);
  const options = [{ v: "", label: "The conversation’s model" }, ...list(models.data?.models).filter((m) => m.available !== false).map((m) => ({ v: `${text(m.provider)}/${text(m.id)}`, label: text(m.name) || text(m.id) }))];
  const label = row.label ?? "Model for summaries";
  return <>
    <Needs engine={engine} need={["models.list", "config.patch"]} where={label}>
      <select className="r1s-inp" aria-label={label} value={value} disabled={!snap} onChange={(e) => void run(() => store.set("agents.defaults.compaction.model", e.target.value || null))}>
        {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** A preview button with nothing behind it yet: its keys (if the preview shows any) and the button, Coming. */
function comingButton(button: string, keys?: () => string): SlotControl {
  return function ComingButton({ engine, row }: SlotControlProps) {
    const src = row.source.kind === "slot" ? row.source : null;
    return <span className="r1s-own-ctl">
      {keys ? <span className="r1s-val g-label">{keys()}</span> : null}
      <Coming engine={engine} need={src?.calls ?? []} unwired reason={src?.reason} where={row.label ?? button}>
        <button type="button" className="r1s-btn">{button}</button>
      </Coming>
    </span>;
  };
}

/** The General page's own controls (plugged.ts). */
export const GENERAL_PAGE: PageSlot = {
  controls: {
    "general.pinned.list": PinnedList,
    "general.projects.list": ProjectList,
    "general.keyboard.shortcuts": KeyboardShortcuts,
    "general.conversation.all": AllConversations,
    "general.summaries.model": SummaryModel,
    "general.history-repair.check": comingButton("Check"),
    "general.quick-ask.shortcut": comingButton("Change…", () => shownInline("Ctrl Shift Space", onMac())),
    "general.cover.now": comingButton("Cover", () => shownInline("Ctrl Alt L", onMac())),
  },
};
