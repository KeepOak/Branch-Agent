// Customize (R1): Personal, what your Trunks can do, and Community, the Seedbank store, behind one switch (preview 44539).
// The Personal view is the preview's frame: a title with the search box, the "For:" faces row, then the kind nav and the
// kind's list and detail (ToolsTab). Trunks and Chat apps are not tabs here: they live in Settings (nav.ts "trunks" and
// "chatapps"). Classic keeps its own CustomizePlace in places/customize/index.tsx.
import { useEffect, useState } from "react";
import { PlaceScroll, type PlaceProps } from "../../places-nav/PlaceFrame";
import { CustomizeWithCommunity } from "../../screens/seedbank/Seedbank";
import { useResource, type Trunks } from "../library/data";
import { CustomizeLevelContext } from "./common";
import type { CommunityKind } from "./kind-chrome";
import { CUSTOMIZE_REQUEST_EVENT, peekCustomizeRequest, requestCustomize, takeCustomizeRequest, type CustomizeRequest, type PromptHandoff } from "./r1-request";
import { KIND_LIST, ToolsTab, type Kind } from "./tools";
import "../library/places.css";
import "./customize.css";

const KINDS: string[] = KIND_LIST.map(k => k.id);
/** Former Customize tabs: their content is a Settings page now. */
const SETTINGS_PAGE: Record<string, string> = { Trunks: "trunks", "Chat apps": "chatapps" };
const asKind = (value: unknown): Kind | null => (typeof value === "string" && KINDS.includes(value) ? value as Kind : null);

export type CustomizeR1Props = PlaceProps & { usePrompt?: PromptHandoff };

export function CustomizeR1Place({ engine, openConversation, openSettings, level, usePrompt }: CustomizeR1Props) {
  const [asked] = useState<CustomizeRequest>(peekCustomizeRequest);
  const [kind, setKind] = useState<Kind>(() => asKind(asked.kind) ?? "Skills");
  const [query, setQuery] = useState("");
  const trunks = useResource<Trunks>(engine, "agents.list");
  useEffect(() => { takeCustomizeRequest(); }, []);
  useEffect(() => {
    const onRequest = (event: Event) => {
      const next = asKind((event as CustomEvent<CustomizeRequest>).detail?.kind);
      if (next) setKind(next);
    };
    const onTab = (event: Event) => {
      const detail = (event as CustomEvent<{ place?: unknown; tab?: unknown }>).detail;
      if (detail?.place !== "customize" || typeof detail.tab !== "string") return;
      if (asKind(detail.tab)) setKind(detail.tab as Kind);
      else if (detail.tab === "Community") requestCustomize({ mode: "community" });
      else if (SETTINGS_PAGE[detail.tab]) openSettings?.(SETTINGS_PAGE[detail.tab]);
    };
    addEventListener(CUSTOMIZE_REQUEST_EVENT, onRequest);
    addEventListener("branch:place-tab", onTab);
    return () => { removeEventListener(CUSTOMIZE_REQUEST_EVENT, onRequest); removeEventListener("branch:place-tab", onTab); };
  }, [openSettings]);
  /** "Get more … in Community" and "＋ Add" open Community on that kind (Prompts and the rest open its first page). */
  const toCommunity = (community?: CommunityKind) => requestCustomize({ mode: "community", community: community ?? "all" });
  const personal = <>
    <div className="cz-titlerow"><h1>Customize</h1>
      <label className="cz-search-title"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.3-4.3" /></svg>
        <input type="search" placeholder="Search tools, skills, agents…" aria-label="Search tools, skills and agents" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
    <div className="cz">
      <ToolsTab engine={engine} level={level} trunks={trunks.data?.agents ?? []} kind={kind} setKind={setKind} getting={false} setGetting={() => undefined}
        openConversation={openConversation} variant="r1" usePrompt={usePrompt} query={query} toCommunity={toCommunity} />
    </div>
  </>;
  return <PlaceScroll>
    <div className="place wide-tools">
      <CustomizeLevelContext.Provider value={level}>
        <div className="cz-r1 kp kp-customize" data-level={level}>
          <CustomizeWithCommunity engine={engine} personal={personal} initial={asked.mode ?? "personal"} initialKind={asked.community} />
        </div>
      </CustomizeLevelContext.Provider>
    </div>
  </PlaceScroll>;
}
