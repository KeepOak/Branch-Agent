// Customize (preview 40-places.js, 42-placesbp.js, 93-g3p.js, 94-g4p.js): Trunks, Tools, Specialists, Channels, Everywhere.
import { TrunksTab } from "./trunks";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { PlaceFrame, type PlaceProps } from "../../places-nav/PlaceFrame";
import { useResource, type Trunks } from "../library/data";
import { KIND_LIST, ToolsTab, type Kind } from "./tools";
import { SpecialistsTab } from "./specialists";
import { ChannelsTab } from "./channels";
import { EverywhereTab } from "./everywhere";
import "../library/places.css";
import "./customize.css";

const TABS = ["Trunks", "Tools", "Specialists", "Channels", "Everywhere"];
const KINDS: string[] = KIND_LIST.map(k => k.id);
/** "branch:place-tab" ({ place, tab }) opens a Customize tab, or Tools at one kind, from elsewhere in the window. */
export function usePlaceTab(open: (tab: string, kind?: string) => void) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    const onTab = (event: Event) => {
      const detail = (event as CustomEvent<{ place?: unknown; tab?: unknown }>).detail;
      if (!detail || detail.place !== "customize" || typeof detail.tab !== "string") return;
      if (TABS.includes(detail.tab)) latest.current(detail.tab);
      else if (KINDS.includes(detail.tab)) latest.current("Tools", detail.tab);
    };
    addEventListener("branch:place-tab", onTab);
    return () => removeEventListener("branch:place-tab", onTab);
  }, []);
}

/** The place's tabs (library Tabs' keyboard model), with the preview's Trunk count after "Trunks" ("Trunks 5"). */
function PlaceTabs({ value, onChange, trunkCount }: { value: string; onChange: (tab: string) => void; trunkCount?: number }) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const n = TABS.length;
    const next = event.key === "ArrowRight" ? (index + 1) % n : event.key === "ArrowLeft" ? (index - 1 + n) % n : event.key === "Home" ? 0 : event.key === "End" ? n - 1 : null;
    if (next === null) return;
    event.preventDefault();
    onChange(TABS[next]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };
  return <div className="kp-tabs" role="tablist" aria-label="Customize">{TABS.map((t, i) => <button key={t} type="button" role="tab" aria-selected={t === value} tabIndex={t === value ? 0 : -1}
    data-count={t === "Trunks" && trunkCount !== undefined ? String(trunkCount) : undefined} aria-label={t === "Trunks" && trunkCount !== undefined ? `Trunks, ${trunkCount}` : undefined}
    onKeyDown={e => move(e, i)} onClick={() => onChange(t)}>{t}</button>)}</div>;
}

export function CustomizePlace({ engine, facts, openConversation, openPlace, openSettings, startConversation, level }: PlaceProps) {
  const [tab, setTab] = useState("Trunks");
  const [kind, setKind] = useState<Kind>("Connectors");
  usePlaceTab((nextTab, nextKind) => { setTab(nextTab); if (nextKind) setKind(nextKind as Kind); });
  const trunks = useResource<Trunks>(engine, "agents.list");
  return <PlaceFrame title="Customize" lede="Who your Trunks are, what they can do, and where you can reach them." wide={tab === "Tools" ? "tools" : undefined}>
    <div className="kp kp-customize"><PlaceTabs value={tab} onChange={setTab} trunkCount={trunks.data?.agents.length} />
      {tab === "Trunks" && <TrunksTab engine={engine} level={level} trunks={trunks} openConversation={openConversation} openPlace={openPlace} openSettings={openSettings} startConversation={startConversation} />}</div>
    {tab !== "Trunks" && <div className="cz">
      {tab === "Channels" ? <ChannelsTab engine={engine} openSettings={openSettings} />
      : tab === "Specialists" ? <SpecialistsTab engine={engine} level={level} trunks={trunks.data?.agents ?? []} facts={facts} openAgents={() => { setKind("Agents"); setTab("Tools"); }} />
      : tab === "Tools" ? <ToolsTab engine={engine} level={level} trunks={trunks.data?.agents ?? []} kind={kind} setKind={setKind} openConversation={openConversation} />
      : <EverywhereTab engine={engine} openChannels={() => setTab("Channels")} />}
    </div>}
  </PlaceFrame>;
}
