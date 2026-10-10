// The Trunk editor (preview editTrunk + 12/15/30-trunks/31-trunksp): a wide dialog, the face and Shuffle on the left,
// the tabs on the right. There is no Save: every change applies the moment it is made (useApply), and the control
// that changed shows a quiet "Saved" tick. Removals offer Undo for 5 seconds. The tabs stay reachable from the keyboard.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { shows, type Level } from "../../places-nav/level";
import type { Draft } from "./api";
import { ComputersTab } from "./ComputersTab";
import { AccountsTab } from "./AccountsTab";
import { canWrite, loadTrunkData, useLoad, WRITE_WHY, type TrunkData } from "./data";
import { EditContext, UndoLine } from "./EditControls";
import { COLOURS, EYES, LookTab, SHAPES } from "./LookTab";
import { readMay } from "./may";
import { ModelsTab, PermissionsTab } from "./MayTab";
import { GitHubTab } from "./GitHubTab";
import { lookOf, LOOKS } from "./model";
import { TrunkFace } from "./TrunkFace";
import { Layer } from "./layer";
import { useApply } from "./useApply";
import "./trunk.css";

export type EditorTab = "look" | "permissions" | "models" | "github" | "computers" | "accounts";
const TABS: [EditorTab, string][] = [["look", "Look"], ["permissions", "Permissions"], ["models", "Models"], ["github", "GitHub"], ["computers", "Its computers"], ["accounts", "Accounts"]];

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

/** The tabs this person sees: GitHub is an Advanced tab, the rest show at every level. */
export function visibleTabs(level: Level): [EditorTab, string][] {
  return TABS.filter(([t]) => t !== "github" || shows(level, "advanced"));
}

function TabRow({ tab, setTab, level }: { tab: EditorTab; setTab: (t: EditorTab) => void; level: Level }) {
  const tabs = visibleTabs(level);
  const key = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = tabs[(tabs.findIndex(([t]) => t === tab) + step + tabs.length) % tabs.length][0];
    setTab(next);
    (e.currentTarget.querySelector(`[data-tab="${next}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div className="tk-tabs" role="tablist" aria-label="Trunk editor" onKeyDown={key}>
      {tabs.map(([t, l]) => <button key={t} type="button" role="tab" data-tab={t} className="tk-tab" aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} onClick={() => setTab(t)}>{l}</button>)}
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
    return <Layer><Dialog title={`Edit ${name}`} wide onClose={onClose} testid="trunk-editor"><p className={data.error ? "tk-error" : "tk-hint"} role={data.error ? "alert" : "status"}>{line}</p></Dialog></Layer>;
  }
  return <EditorBody {...props} data={data.data} initial={initial} />;
}

/** A new look for Shuffle: an unused look when one is free, otherwise any look but the current one. */
function shuffledLook(draft: Draft, data: TrunkData, agentId: string): Partial<Draft> {
  if (draft.look === "classic") {
    const combinations = COLOURS.flatMap((colour) => SHAPES.flatMap((shape) => EYES.map((eyes) => ({ colour, shape, eyes }))));
    const alternatives = combinations.filter((look) => look.colour !== draft.colour || look.shape !== draft.shape || look.eyes !== draft.eyes);
    return alternatives[Math.floor(Math.random() * alternatives.length)];
  }
  const worn = new Set(data.roster.agents.filter((a) => a.id !== agentId).map((a) => lookOf(a.avatar, a.name)));
  const free = LOOKS.filter((l) => l.id !== "classic" && l.id !== "branch" && l.id !== draft.look && !worn.has(l.id));
  const pool = free.length ? free : LOOKS.filter((l) => l.id !== "classic" && l.id !== "branch" && l.id !== draft.look);
  return { look: pool[Math.floor(Math.random() * pool.length)].id, emoji: "" };
}

/** The dialog opens without focus on a control, so the body stays at its top (the shared dialog's first focus scrolls a narrow window). */
function useQuietFocus() {
  useEffect(() => {
    const dlg = document.querySelector<HTMLElement>('[data-testid="trunk-editor"]');
    if (!dlg) return;
    dlg.tabIndex = -1;
    dlg.focus({ preventScroll: true });
    const body = dlg.querySelector<HTMLElement>(".dlg-b");
    if (body) body.scrollTop = 0;
  }, []);
}

type PanelProps = { engine: WindowEngine; agentId: string; name: string; level: Level; tab: EditorTab; draft: Draft; data: TrunkData; set: (d: Partial<Draft>) => void; openSettings?: (page: string) => void };
function Panel({ engine, agentId, name, level, tab, draft, data, set, openSettings }: PanelProps) {
  if (tab === "look") return <LookTab draft={draft} set={set} />;
  if (tab === "permissions") return <PermissionsTab draft={draft} set={set} />;
  if (tab === "models") return <ModelsTab name={name} draft={draft} models={data.models} level={level} set={set} openSettings={openSettings} />;
  if (tab === "github") return <GitHubTab engine={engine} agentId={agentId} />;
  if (tab === "computers") return <ComputersTab name={name} draft={draft} computers={data.computers} set={set} openSettings={openSettings} />;
  return <AccountsTab engine={engine} agentId={agentId} />;
}

function EditorBody({ engine, agentId, level, onClose, onSaved, openSettings, tab: first, data, initial }: TrunkEditorProps & { data: TrunkData; initial: Draft }) {
  const [tab, setTab] = useState<EditorTab>(first ?? "look");
  const write = canWrite(engine);
  const edit = useApply(engine, agentId, initial, write);
  useQuietFocus();
  const shuffle = () => edit.set(shuffledLook(edit.draft, data, agentId));
  const close = () => void edit.settled().then((touched) => { if (touched) onSaved?.(); onClose(); });
  return (
    <Layer><Dialog title={`Edit ${initial.name}`} wide onClose={close} testid="trunk-editor">
      <EditContext.Provider value={{ saved: edit.saved, write }}>
        <div className="tk-editor">
          <div className="tk-big">
            <TrunkFace name={edit.draft.name || initial.name} look={edit.draft.look} emoji={edit.draft.emoji} pebbleLook={edit.draft} size={84} draft />
            <button type="button" className="btn sm" onClick={shuffle}>Shuffle</button>
          </div>
          <div className="tk-col">
            <TabRow tab={tab} setTab={setTab} level={level} />
            <div role="tabpanel" aria-label={TABS.find(([t]) => t === tab)?.[1]}>
              <Panel engine={engine} agentId={agentId} name={initial.name} level={level} tab={tab} draft={edit.draft} data={data} set={edit.set} openSettings={openSettings} />
            </div>
            {data.partial.map((p) => <p key={p} className="tk-hint" role="status">{p}</p>)}
            {!write && <p className="tk-hint" role="status">{WRITE_WHY}</p>}
            {edit.undo && <UndoLine label={edit.undo.label} onUndo={edit.undoLast} />}
            {edit.error && <p className="tk-error" role="alert">{edit.error}</p>}
          </div>
        </div>
      </EditContext.Provider>
    </Dialog></Layer>
  );
}
