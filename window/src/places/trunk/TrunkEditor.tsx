// The Trunk editor (preview editTrunk + 12/15/30-trunks/31-trunksp): a wide dialog, the face and Shuffle on the left,
// Look / What it may do / Its computers on the right; Cancel and Save. Save sends agents.update then one config.patch.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { notify } from "../../shell/notify";
import type { Level } from "../../places-nav/level";
import { saveTrunk, type Draft } from "./api";
import { ComputersTab } from "./ComputersTab";
import { AccountsTab } from "./AccountsTab";
import { canWrite, loadTrunkData, useLoad, WRITE_WHY, type TrunkData } from "./data";
import { COLOURS, EYES, LookTab, SHAPES } from "./LookTab";
import { readMay } from "./may";
import { MayTab } from "./MayTab";
import { errorText, lookOf, LOOKS } from "./model";
import { TrunkFace } from "./TrunkFace";
import { Layer } from "./layer";
import "./trunk.css";

export type EditorTab = "look" | "may" | "computers" | "accounts";
const TABS: [EditorTab, string][] = [["look", "Look"], ["may", "What it may do"], ["computers", "Its computers"], ["accounts", "Accounts"]];

export type TrunkEditorProps = {
  engine: WindowEngine;
  agentId: string;
  level: Level;
  onClose: () => void;
  /** Called after a save the engine confirmed (the profile reopens from here when it opened the editor). */
  onSaved?: () => void;
  openSettings?: (page: string) => void;
  tab?: EditorTab;
};

function draftOf(data: TrunkData, id: string): Draft | null {
  const row = data.roster.agents.find((a) => a.id === id);
  if (!row) return null;
  return { name: row.name, theme: row.theme, look: lookOf(row.avatar, row.name), emoji: row.emoji, colour: row.colour || COLOURS[0], shape: row.shape || SHAPES[0], eyes: row.eyes || EYES[0], model: row.model, may: readMay(data.snap, id) };
}

function TabRow({ tab, setTab }: { tab: EditorTab; setTab: (t: EditorTab) => void }) {
  const key = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = TABS[(TABS.findIndex(([t]) => t === tab) + step + TABS.length) % TABS.length][0];
    setTab(next);
    (e.currentTarget.querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className="tk-tabs" role="tablist" aria-label="Trunk editor" onKeyDown={key}>
      {TABS.map(([t, l]) => <button key={t} type="button" role="tab" data-tab={t} className="tk-tab" aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)}>{l}</button>)}
    </div>
  );
}

export function TrunkEditor(props: TrunkEditorProps) {
  const { engine, agentId, onClose } = props;
  const data = useLoad(() => loadTrunkData(engine), agentId);
  const initial = useMemo(() => (data.data ? draftOf(data.data, agentId) : null), [data.data, agentId]);
  const name = initial?.name || agentId;
  if (!data.data || !initial) {
    const line = data.error || (data.loading ? "Reading this Trunk…" : "This Trunk is no longer in the engine’s list.");
    return <Layer><Dialog title={`Edit ${name}`} wide onClose={onClose} testid="trunk-editor" footer={<button type="button" className="btn ghost" onClick={onClose}>Cancel</button>}><p className={data.error ? "tk-error" : "tk-hint"} role={data.error ? "alert" : "status"}>{line}</p></Dialog></Layer>;
  }
  return <EditorBody {...props} data={data.data} initial={initial} />;
}

function EditorBody({ engine, agentId, level, onClose, onSaved, openSettings, tab: first, data, initial }: TrunkEditorProps & { data: TrunkData; initial: Draft }) {
  const [tab, setTab] = useState<EditorTab>(first ?? "look");
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The preview's editor redraws itself as it opens, so focus ends on the dialog, not on a control: nothing shows a
  // ring and the body stays at its top (the shared dialog's first focus would scroll a narrow window down to Name).
  // Escape still closes it and Tab moves to the first control.
  useEffect(() => {
    const dlg = document.querySelector<HTMLElement>('[data-testid="trunk-editor"]');
    if (!dlg) return;
    dlg.tabIndex = -1;
    dlg.focus({ preventScroll: true });
    const body = dlg.querySelector<HTMLElement>(".dlg-b");
    if (body) body.scrollTop = 0;
  }, []);
  const set = (d: Partial<Draft>) => setDraft((x) => ({ ...x, ...d }));
  const shuffle = () => {
    if (draft.look === "classic") {
      const combinations = COLOURS.flatMap((colour) => SHAPES.flatMap((shape) => EYES.map((eyes) => ({ colour, shape, eyes }))));
      const alternatives = combinations.filter((look) => look.colour !== draft.colour || look.shape !== draft.shape || look.eyes !== draft.eyes);
      set(alternatives[Math.floor(Math.random() * alternatives.length)]);
    } else {
      const worn = new Set(data.roster.agents.filter((a) => a.id !== agentId).map((a) => lookOf(a.avatar, a.name)));
      const free = LOOKS.filter((l) => l.id !== "classic" && l.id !== "branch" && l.id !== draft.look && !worn.has(l.id));
      const pool = free.length ? free : LOOKS.filter((l) => l.id !== "classic" && l.id !== "branch" && l.id !== draft.look);
      set({ look: pool[Math.floor(Math.random() * pool.length)].id, emoji: "" });
    }
  };
  const changed = JSON.stringify(draft) !== JSON.stringify(initial);
  const save = async () => {
    setBusy(true); setError(null);
    try { await saveTrunk(engine, agentId, initial, draft); notify(`${draft.name.trim() || initial.name} is saved.`); onSaved?.(); onClose(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  const write = canWrite(engine);
  const footer = <>
    <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
    <button type="button" className="btn pri" disabled={busy || !changed || !write || !draft.name.trim()} title={write ? undefined : WRITE_WHY} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
  </>;
  return (
    <Layer><Dialog title={`Edit ${initial.name}`} wide onClose={onClose} footer={footer} testid="trunk-editor">
      <div className="tk-editor">
        <div className="tk-big">
          <TrunkFace name={draft.name || initial.name} look={draft.look} emoji={draft.emoji} pebbleLook={draft} size={84} draft />
          <button type="button" className="btn sm" onClick={shuffle}>Shuffle</button>
        </div>
        <div className="tk-col">
          <TabRow tab={tab} setTab={setTab} />
          <div role="tabpanel" aria-label={TABS.find(([t]) => t === tab)?.[1]}>
            {tab === "look" && <LookTab draft={draft} set={set} />}
            {tab === "may" && <MayTab engine={engine} agentId={agentId} name={initial.name} draft={draft} models={data.models} level={level} set={set} openSettings={openSettings} />}
            {tab === "computers" && <ComputersTab name={initial.name} draft={draft} computers={data.computers} set={set} openSettings={openSettings} />}
            {tab === "accounts" && <AccountsTab engine={engine} agentId={agentId} />}
          </div>
          {data.partial.map((p) => <p key={p} className="tk-hint" role="status">{p}</p>)}
          {error && <p className="tk-error" role="alert">{error}</p>}
        </div>
      </div>
    </Dialog></Layer>
  );
}
