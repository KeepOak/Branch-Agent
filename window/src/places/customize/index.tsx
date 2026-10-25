// Customize keeps Tools. Trunks and Chat apps live in Settings (QUEUE-PASS17 31.1);
// requests for their old tabs open the corresponding Settings pages (#1049).
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { PlaceFrame, type PlaceProps } from "../../places-nav/PlaceFrame";
import { useResource, type Trunks } from "../library/data";
import { KIND_LIST, ToolsTab, type Kind } from "./tools";
import "../library/places.css";
import "./customize.css";

const TABS = ["Tools"];
/** The old Chat apps tab's name: asking for it opens Settings › Chat apps. */
export const CHAT_APPS_TAB = "Chat apps";
export const TRUNKS_TAB = "Trunks";
const KINDS: string[] = KIND_LIST.map(k => k.id);
/** "branch:place-tab" ({ place, tab }) opens a Customize tab, or Tools at one kind, from elsewhere in the window. */
export function usePlaceTab(open: (tab: string, kind?: string, capabilities?: boolean) => void) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    const onTab = (event: Event) => {
      const detail = (event as CustomEvent<{ place?: unknown; tab?: unknown }>).detail;
      if (!detail || detail.place !== "customize" || typeof detail.tab !== "string") return;
      if (TABS.includes(detail.tab) || detail.tab === CHAT_APPS_TAB || detail.tab === TRUNKS_TAB) latest.current(detail.tab);
      else if (KINDS.includes(detail.tab)) latest.current("Tools", detail.tab);
      else if (detail.tab === "Get capabilities") latest.current("Tools", "Skills", true);
    };
    addEventListener("branch:place-tab", onTab);
    return () => removeEventListener("branch:place-tab", onTab);
  }, []);
}

/** The place's tabs, using library Tabs' keyboard model. */
function PlaceTabs({ value, onChange }: { value: string; onChange: (tab: string) => void }) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const n = TABS.length;
    const next = event.key === "ArrowRight" ? (index + 1) % n : event.key === "ArrowLeft" ? (index - 1 + n) % n : event.key === "Home" ? 0 : event.key === "End" ? n - 1 : null;
    if (next === null) return;
    event.preventDefault();
    onChange(TABS[next]);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };
  return <div className="kp-tabs" role="tablist" aria-label="Customize">{TABS.map((t, i) => <button key={t} type="button" role="tab" aria-selected={t === value} tabIndex={t === value ? 0 : -1}
    onKeyDown={e => move(e, i)} onClick={() => onChange(t)}>{t}</button>)}</div>;
}

export function CustomizePlace({ engine, openConversation, openSettings, level }: PlaceProps) {
  const [tab, setTab] = useState("Tools");
  const [kind, setKind] = useState<Kind>("Connectors");
  const [getting, setGetting] = useState(false);
  usePlaceTab((nextTab, nextKind, capabilities) => {
    if (nextTab === CHAT_APPS_TAB) { openSettings?.("chatapps"); return; }
    if (nextTab === TRUNKS_TAB) { openSettings?.("trunks"); return; }
    setTab(nextTab); if (nextKind) setKind(nextKind as Kind); setGetting(capabilities === true);
  });
  const trunks = useResource<Trunks>(engine, "agents.list");
  return <PlaceFrame title="Customize" lede="What your Trunks can do." wide="tools">
    <div className="kp kp-customize"><PlaceTabs value={tab} onChange={setTab} /></div>
    {tab === "Tools" && <div className="cz">
      <ToolsTab engine={engine} level={level} trunks={trunks.data?.agents ?? []} kind={kind} setKind={setKind} getting={getting} setGetting={setGetting} openConversation={openConversation} openSettings={openSettings} />
    </div>}
  </PlaceFrame>;
}
