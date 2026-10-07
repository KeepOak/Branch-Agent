// Automations (§4.6.3; preview 40-places / 41-placesap p30-sched, p35-prop, p40-auto-other, 94-g4p).
// Scheduling contracts adapted from engine/ui cron form/controller.
import { useCallback, useEffect, useState, type KeyboardEvent } from "react";
import { PlaceFrame, type PlaceProps } from "../../places-nav/PlaceFrame";
import { Checkins } from "./Checkins";
import { formToSchedule, scheduleWords as words, type ScheduleForm } from "./model";
import { canAdmin, ScheduledTab } from "./Scheduled";
import { TriggersTab } from "./Triggers";
import { ProceduresTab } from "./Procedures";
import { BoardTab } from "./Board";
import { canWrite, rec, str, usePlaceData, type Row } from "./runtime";
import { loadCanopy } from "../canopy/data";
import "./activity.css";
import "./automations.css";
import "./board-cards.css";

const TABS = [["scheduled", "Scheduled"], ["procedures", "Procedures"], ["triggers", "Triggers"], ["checkins", "Check-ins"], ["board", "Board"]] as const;
type Tab = (typeof TABS)[number][0];

/** The older explicit-fields schedule shape (kept for callers that build schedules from raw fields). */
export type Draft = { name: string; message: string; kind: string; expression: string; timezone: string; every: string; at: string; agentId: string; payloadKind: string };
export function scheduleFromDraft(draft: Draft): Row {
  if (draft.kind === "every") {
    const minutes = Number(draft.every);
    if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isSafeInteger(minutes * 60000)) throw new Error("Enter a positive interval in minutes.");
    return { kind: "every", everyMs: minutes * 60000 };
  }
  if (draft.kind === "at") {
    const date = new Date(draft.at);
    if (!draft.at || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error("Choose a future date and time.");
    return { kind: "at", at: date.toISOString() };
  }
  if (!draft.expression.trim()) throw new Error("Enter the schedule expression. The engine validates it before saving.");
  if (draft.timezone.trim()) { try { new Intl.DateTimeFormat("en", { timeZone: draft.timezone }).format(); } catch { throw new Error("Enter a valid time zone."); } }
  const form: ScheduleForm = { repeat: "custom", expr: draft.expression, tz: draft.timezone, time: "", weekday: 0, monthDay: 1, at: "", everyN: "", everyUnit: "minutes", exact: false, spreadN: "", spreadUnit: "seconds" };
  return formToSchedule(form);
}
export function scheduleWords(job: Row): string { return words(rec(job.schedule)) || str(rec(job.schedule).kind); }

/** The tab a "branch:place-tab" event names, by its visible name or its id; null when it isn't one of ours. */
export function tabFromEvent(detail: unknown): Tab | null {
  const d = rec(detail), want = str(d.tab).trim().toLowerCase();
  if (d.place !== "automations" || !want) return null;
  return TABS.find(([id, name]) => id === want || name.toLowerCase() === want)?.[0] ?? null;
}

export function AutomationsPlace({ engine, openConversation, openPlace, level }: PlaceProps) {
  const [tab, setTab] = useState<Tab>("scheduled");
  const [sheet, setSheet] = useState("");
  const state = usePlaceData(engine, loadCanopy);
  
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const next = event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(TABS[next][0]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };
  
  useEffect(() => {
    const onTab = (e: Event) => { const next = tabFromEvent((e as CustomEvent).detail); if (next) setTab(next); };
    window.addEventListener("branch:place-tab", onTab);
    return () => window.removeEventListener("branch:place-tab", onTab);
  }, []);
  
  const act = useCallback(async (op: () => Promise<unknown>, message: string) => {
    const ok = await state.act(op, message);
    if (!ok) void state.refresh();
    return ok;
  }, [state]);
  
  const openCard = useCallback((id: string) => {
    setSheet(id);
    openPlace("canopy");
    setTimeout(() => window.dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "canopy", tab: "Cards" } })), 0);
  }, [openPlace]);
  
  return <PlaceFrame title="Automations" lede="Work your Trunks do on their own.">
    <div className="auto-place">
      <div className="au-tabs" role="tablist" aria-label="Automations">{TABS.map(([id, name], index) => <button key={id} type="button" role="tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onKeyDown={event => moveTab(event, index)} onClick={() => setTab(id)}>{name}</button>)}</div>
      {!canAdmin(engine) && <div className="au-banner" role="status"><i className="au-dot" /><span className="au-grow"><small>You can look, but changing automations needs an owner.</small></span></div>}
      {tab === "scheduled" && <ScheduledTab engine={engine} level={level} openConversation={openConversation} />}
      {tab === "procedures" && <ProceduresTab engine={engine} level={level} />}
      {tab === "triggers" && <TriggersTab engine={engine} level={level} openConversation={openConversation} />}
      {tab === "checkins" && <Checkins engine={engine} level={level} />}
      {tab === "board" && <BoardTab 
        openPlace={openPlace}
        data={state.data}
        engine={engine}
        openCard={openCard}
        write={canWrite(engine)}
        busy={state.busy}
        act={act}
      />}
    </div>
  </PlaceFrame>;
}
