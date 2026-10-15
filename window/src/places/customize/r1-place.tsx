// Customize (R1): Personal, what your Trunks can do, and Community, the Seedbank store, behind one switch (preview 44539).
// Trunks and Chat apps are not tabs here: they live in Settings (nav.ts "trunks" and "chatapps"). Classic keeps its own
// CustomizePlace in places/customize/index.tsx, so this file is the only place R1 mounts Customize.
import { useEffect, useState } from "react";
import { PlaceFrame, type PlaceProps } from "../../places-nav/PlaceFrame";
import { CustomizeWithCommunity } from "../../screens/seedbank/Seedbank";
import { useResource, type Trunks } from "../library/data";
import { CustomizeLevelContext } from "./common";
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
  const personal = <div className="cz">
    <ToolsTab engine={engine} level={level} trunks={trunks.data?.agents ?? []} kind={kind} setKind={setKind} getting={false} setGetting={() => undefined}
      openConversation={openConversation} variant="r1" usePrompt={usePrompt} />
  </div>;
  return <PlaceFrame title="Customize" lede="" wide="tools">
    <CustomizeLevelContext.Provider value={level}>
      <div className="cz-r1 kp kp-customize" data-level={level}>
        <CustomizeWithCommunity engine={engine} personal={personal} initial={asked.mode ?? "personal"} />
      </div>
    </CustomizeLevelContext.Provider>
  </PlaceFrame>;
}
