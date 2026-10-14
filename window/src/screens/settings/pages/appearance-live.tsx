// Settings › Appearance: the controls the R1 page draws itself (slots.ts controls), so every working control of the
// Classic Appearance page has its R1 row (R1 README rule 6). Each one reuses Classic's own logic on the same keys
// (appearance-top, appearance-themes, appearance-editor, appearance-pet, appearance-more): light or dark, the theme
// gallery and the theme editor, any accent colour, hold to preview the background, the pet and the pets you've had, each
// Trunk's model and stage, how threads show, and the small model line. Every control names the engine call it makes, or
// says data-local when it stays in this window.
import { cloneElement, useEffect, useMemo, useState, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { canAll } from "../../../connect/capabilities";
import { Coming } from "../../../glass/coming";
import { configStore } from "../../../places/settings/config-store";
import { errorText, list, record, visible, type RecordValue } from "../../../places/settings/adapter";
import { useResource } from "../../../places/settings/hooks";
import { KitProvider, type SaveReport } from "../../../places/settings/kit";
import { startFrom, useThemeActs } from "../../../places/settings/set1/appearance";
import { ACCENTS, ThemeEditor, type EditStart } from "../../../places/settings/set1/appearance-editor";
import { DEFAULT_THEME, isHex, SLATE } from "../../../places/settings/set1/appearance-look";
import { DEFAULT_PET, PETS, petsHad, pickPet } from "../../../places/settings/set1/appearance-pet";
import { sceneFile, useLook } from "../../../places/settings/set1/appearance-store";
import { localId, Swatch, themeGroup, themeName, ThemesDialog, useThemes, type Extra } from "../../../places/settings/set1/appearance-themes";
import { useThemeChoice, useTrunk } from "../../../places/settings/set1/appearance-top";
import { readTopicSettings, setDefaultTopicLayout, TOPIC_LAYOUT_KEY, topicLayoutNames, type TopicLayout } from "../../../shell/topic-layout";
import { setThemeChoice, type ThemeChoice } from "../../../theme/theme";
import { Segmented } from "../RowView";
import type { SlotControlProps } from "../slots";

type Look = ReturnType<typeof useLook>;

/** The calls a change to the person's look makes: none while the look stays on this device (no signed-in person). */
const lookCalls = (look: Look): string[] => (look.snap.where === "device" ? [] : ["users.prefs.set"]);

/** One control and the calls it makes: through Coming when it makes some, else marked data-local. */
export function Needs({ engine, need, where, children }: { engine: WindowEngine; need: string[]; where: string; children: ReactElement }) {
  return need.length ? <Coming engine={engine} need={need} where={where}>{children}</Coming> : cloneElement(children, { "data-local": "" } as Record<string, unknown>);
}

/** A failed change, on its own pill under the control. */
export const Failed = ({ text }: { text: string }) => (text ? <small className="r1s-msg r1s-bad g-label" role="status" data-lines>{text}</small> : null);

/** Runs a change and keeps its failure to show; Classic's own save runner (useSaveRunner) reports here too. */
export function useFailure(): [string, (run: () => Promise<unknown>) => Promise<boolean>, SaveReport] {
  const [text, setText] = useState("");
  const report = useMemo<SaveReport>(() => ({ saving: () => setText(""), saved: () => setText(""), failed: (m) => setText(m) }), []);
  const run = async (fn: () => Promise<unknown>) => {
    setText("");
    try { await fn(); return true; } catch (e) { setText(errorText(e)); return false; }
  };
  return [text, run, report];
}

const MODES: { v: ThemeChoice; label: string }[] = [{ v: "light", label: "Light" }, { v: "dark", label: "Dark" }, { v: "system", label: "Match this computer" }];

/** Light, dark or match this computer: the window's own switch (as the top bar's button), and themes.set {mode} for a
 *  signed-in person, as Classic's Light or dark. */
export function LightOrDark({ engine, row }: SlotControlProps) {
  const [choice] = useThemeChoice();
  const look = useLook(engine);
  const [failed, run] = useFailure();
  const saves = look.snap.where === "profile" && canAll(engine, ["themes.set"]);
  const pick = (v: unknown) => {
    const c = v as ThemeChoice;
    setThemeChoice(c);
    if (saves) void run(() => engine.request("themes.set", { mode: c }));
  };
  return <>
    <div className="r1s-own-ctl" data-need={saves ? "themes.set" : undefined} data-local={saves ? undefined : ""}>
      <Segmented label={row.label ?? "Light or dark"} value={choice} options={MODES} onChange={pick} />
    </div>
    <Failed text={failed} />
  </>;
}

/** The theme now, Browse all (the gallery: pick, add, delete, edit) and Make your own (the theme editor), with Classic's
 *  own theme actions (themes.set, themes.import, users.prefs.set). */
export function ThemePicker(props: SlotControlProps) {
  const [failed, , report] = useFailure();
  return <KitProvider level={0} report={report} scope={null}><ThemeNow {...props} failed={failed} /></KitProvider>;
}

type Open = { kind: "gallery" } | { kind: "edit"; start: EditStart } | null;
function ThemeNow({ engine, failed }: SlotControlProps & { failed: string }) {
  const look = useLook(engine);
  const extra = record(look.val("themeExtra", {})) as Extra;
  const themes = useThemes(engine, extra);
  const trunk = useTrunk(engine);
  const [, mode] = useThemeChoice();
  const [open, setOpen] = useState<Open>(null);
  const profile = look.snap.where === "profile";
  const currentId = profile ? themes.current?.id ?? DEFAULT_THEME : String(look.val("theme", themes.current?.id ?? DEFAULT_THEME));
  const current = themes.list.find((t) => t.id === currentId);
  const pair = themes.pairOf(currentId) ?? SLATE;
  const acts = useThemeActs({ engine }, look, themes, extra, profile);
  const accent = String(look.val("accent", ""));
  const contrast = look.val("contrast", false) === true;
  const make = (withAccent: boolean) => setOpen({ kind: "edit", start: startFrom(current, currentId, pair, withAccent ? accent : "") });
  const pickCalls = profile ? ["themes.list", "themes.set"] : ["themes.list"];
  return <>
    <div className="r1s-item">
      <span className="r1s-swatch" aria-hidden="true"><Swatch c={pair[mode]} /></span>
      <span className="r1s-item-t g-label" data-lines>
        <b>{current ? themeName(current) : themes.loading ? "Reading your theme…" : "Branch Slate"}</b>
        <small>{[current ? themeGroup(current) : "Branch", mode === "dark" ? "Moonlight" : "Daylight", contrast ? "more contrast" : ""].filter(Boolean).join(" · ")}</small>
      </span>
    </div>
    <div className="r1s-acts">
      <Needs engine={engine} need={pickCalls} where="Browse all themes">
        <button type="button" className="r1s-btn" disabled={themes.loading || Boolean(themes.error)} onClick={() => setOpen({ kind: "gallery" })}>{themes.list.length ? `Browse all ${themes.list.length} themes` : "Browse themes"}</button>
      </Needs>
      <Needs engine={engine} need={["themes.import"]} where="Make your own theme">
        <button type="button" className="r1s-btn" disabled={themes.loading} onClick={() => make(false)}>Make your own</button>
      </Needs>
      {isHex(accent) ? (
        <Needs engine={engine} need={["themes.import"]} where="Save the accent as a theme">
          <button type="button" className="r1s-btn" disabled={themes.loading} onClick={() => make(true)}>Save the accent as a theme</button>
        </Needs>
      ) : null}
    </div>
    {themes.error ? <small className="r1s-msg r1s-bad g-label" data-lines>{visible(themes.error)}</small> : null}
    {look.snap.where === "device" ? <small className="r1s-msg g-label" data-lines>{look.snap.error ? `Kept on this computer: your look couldn’t be read from Branch: ${visible(look.snap.error)}` : "Kept on this computer: this window has no signed-in profile, so your look stays here instead of following you."}</small> : null}
    <Failed text={failed} />
    {open?.kind === "gallery" ? (
      <ThemesDialog themes={themes} currentId={currentId} mode={mode} contrast={contrast}
        onContrast={(on) => void look.store.set("contrast", on ? true : null)} onPick={acts.pick} onMake={() => make(false)} onImport={acts.add} onDelete={acts.remove}
        onEdit={(t) => setOpen({ kind: "edit", start: { id: localId(t.id), name: t.name, base: currentId, pair: themes.pairOf(t.id) ?? SLATE } })} onClose={() => setOpen(null)} />
    ) : null}
    {open?.kind === "edit" ? (
      <ThemeEditor start={open.start} themes={themes} mode={mode} trunks={trunk.agents.map(trunk.nameOf)} onPreview={look.store.setPreviewFn} onSave={acts.saveOwn} onClose={() => setOpen(null)} />
    ) : null}
  </>;
}

/** The accent: the theme's own, one of the eight, or any colour (Classic's colour well). Saved to the look's "accent". */
export function AccentColour({ engine }: SlotControlProps) {
  const look = useLook(engine);
  const [failed, run] = useFailure();
  const [, mode] = useThemeChoice();
  const accent = look.val("accent", null);
  const own = isHex(accent) && !ACCENTS.includes(accent.toLowerCase());
  const set = (v: string | null) => void run(() => look.store.set("accent", v));
  const need = lookCalls(look);
  return <>
    <Needs engine={engine} need={need} where="Accent colour">
      <span className="r1s-own-ctl">
        <select className="r1s-inp" aria-label="Accent colour" value={isHex(accent) ? accent.toLowerCase() : "theme"} onChange={(e) => set(e.target.value === "theme" ? null : e.target.value)}>
          <option value="theme">The theme’s own</option>
          {ACCENTS.map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}
          {own ? <option value={accent.toLowerCase()}>{accent.toUpperCase()} · your colour</option> : null}
        </select>
        <input className="r1s-well" type="color" aria-label="Any colour" value={isHex(accent) ? accent : SLATE[mode].accent} onChange={(e) => set(e.target.value.toLowerCase())} />
      </span>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** Hold to see the background on its own (Classic's See it clearly): the window steps its glass aside while held. */
export function BackgroundPreview({ engine }: SlotControlProps) {
  const look = useLook(engine);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!held) return;
    document.documentElement.classList.add("scene-peek");
    const close = () => setHeld(false);
    const keydown = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
    const keyup = (e: KeyboardEvent) => { if ([" ", "Enter", "Escape"].includes(e.key)) close(); };
    const on: [EventTarget, string, EventListener, boolean?][] = [[window, "pointerup", close, true], [window, "pointercancel", close, true], [window, "keyup", keyup as EventListener, true], [window, "keydown", keydown as EventListener, true], [window, "blur", close]];
    for (const [t, ev, fn, cap] of on) t.addEventListener(ev, fn, cap);
    return () => { document.documentElement.classList.remove("scene-peek"); for (const [t, ev, fn, cap] of on) t.removeEventListener(ev, fn, cap); };
  }, [held]);
  const why = String(look.val("bg", "none")) === "none" ? "Pick a background first." : sceneFile(look.snap.look) ? undefined : "Not drawn yet.";
  return <>
    <button type="button" className="r1s-btn" data-local="" disabled={Boolean(why)} title={why}
      onPointerDown={(e) => { e.preventDefault(); setHeld(true); }} onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!e.repeat) setHeld(true); } }}>See it clearly</button>
    {why ? <small className="r1s-msg g-label" data-lines>{why}</small> : null}
  </>;
}

/** The pet, keeping the pets you've had and the day of the first, as Classic's pet gallery does. */
export function PetPick({ engine }: SlotControlProps) {
  const look = useLook(engine);
  const [failed, run] = useFailure();
  const cur = String(look.val("pet", DEFAULT_PET));
  const pick = (id: string) => void run(() => pickPet(look, id));
  return <>
    <Needs engine={engine} need={lookCalls(look)} where="Pet">
      <select className="r1s-inp" aria-label="Pet" value={cur} onChange={(e) => pick(e.target.value)}>
        {PETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** How many pets you've had, and when the first came. */
export function PetsHad({ engine }: SlotControlProps) {
  const look = useLook(engine);
  const had = petsHad(look), first = look.val("petFirst", "");
  return <span className="r1s-val g-label">{`${had.length} of ${PETS.length - 1}${first ? ` · first ${String(first)}` : ""}`}</span>;
}

const STAGE_BG = [["none", "None"], ["rings", "Growth rings"], ["oak", "Oak"]];

/** Each Trunk's model (agents.update) and the stage behind its character (the look's "stage:<id>"). */
export function EachTrunk({ engine }: SlotControlProps) {
  const look = useLook(engine);
  const trunk = useTrunk(engine);
  const models = useResource<RecordValue>(engine, "models.list", {});
  const [failed, run] = useFailure();
  const refs = list(models.data?.models).map((m) => ({ id: `${String(m.provider)}/${String(m.id)}`, label: visible(m.name ?? m.id) }));
  const setModel = (id: string, v: string) => void run(async () => { await engine.request("agents.update", { agentId: id, model: v || null }); await trunk.reload(); });
  if (!trunk.agents.length) return <small className="r1s-msg g-label">Reading your Trunks…</small>;
  return <>
    <div className="r1s-items">
      {trunk.agents.map((a) => {
        const id = String(a.id), name = trunk.nameOf(a), model = String(record(a.model).primary ?? "");
        return (
          <div key={id} className="r1s-item">
            <span className="r1s-item-t g-label"><b>{name}</b></span>
            <span className="r1s-acts">
              <Needs engine={engine} need={["models.list", "agents.update"]} where={`${name}: model`}>
                <select className="r1s-inp" aria-label={`${name}: model`} value={model} disabled={models.loading} onChange={(e) => setModel(id, e.target.value)}>
                  <option value="">Default</option>
                  {model && !refs.some((r) => r.id === model) ? <option value={model}>{visible(model)}</option> : null}
                  {refs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </Needs>
              <Needs engine={engine} need={lookCalls(look)} where={`${name}: background`}>
                <select className="r1s-inp" aria-label={`${name}: background`} value={String(look.val(`stage:${id}`, "none"))} onChange={(e) => void run(() => look.store.set(`stage:${id}`, e.target.value === "none" ? null : e.target.value))}>
                  {STAGE_BG.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Needs>
            </span>
          </div>
        );
      })}
    </div>
    <Failed text={failed || (models.error ? visible(models.error) : "")} />
  </>;
}

const LAYOUTS = (Object.entries(topicLayoutNames) as [TopicLayout, string][]).map(([v, label]) => ({ v, label: label === "Tabs above the chat" ? "Tabs" : label }));

/** How a contact's threads show beside its chat, for every contact without its own (kept in this window). */
export function ThreadsShowAs({ row }: SlotControlProps) {
  const [layout, setLayout] = useState(() => readTopicSettings().layout);
  useEffect(() => {
    const sync = () => setLayout(readTopicSettings().layout);
    const storage = (e: StorageEvent) => { if (e.key === TOPIC_LAYOUT_KEY) sync(); };
    window.addEventListener("branch:topic-layout-changed", sync);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener("branch:topic-layout-changed", sync); window.removeEventListener("storage", storage); };
  }, []);
  return <div className="r1s-own-ctl" data-local="">
    <Segmented label={row.label ?? "Threads show as"} value={layout} options={LAYOUTS} onChange={(v) => { setDefaultTopicLayout(v as TopicLayout); setLayout(v as TopicLayout); }} />
  </div>;
}

/** The small model Branch uses for smaller jobs (agents.defaults.utilityModel), with a way to Models to change it. */
export function SmallModel({ engine, onPage }: SlotControlProps) {
  const store = configStore(engine);
  const snap = useSyncExternalStore((fn) => store.subscribe(fn), () => store.snap, () => store.snap);
  useEffect(() => { if (!store.snap) void store.load(); }, [store]);
  const small = record(record(record(snap?.config).agents).defaults).utilityModel;
  const where = "set in Models › Sub-tasks and side jobs";
  const line: ReactNode = !snap ? "Reading…" : small === undefined ? "Chosen by Branch (Automatic, from Models › Sub-tasks and side jobs)" : small === "" ? `None (${where})` : `${visible(small)} (${where})`;
  return <>
    <span className="r1s-val g-label" data-lines>{line}</span>
    <button type="button" className="r1s-link" data-local="" disabled={!onPage} onClick={() => onPage?.("models")}>Change</button>
  </>;
}
