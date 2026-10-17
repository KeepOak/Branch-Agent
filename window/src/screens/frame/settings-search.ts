// What Settings search also finds in the R1 window (HANDOFF R1-06, owner item 21 point 4; preview X.searchHtml): up to
// 5 Trunks (open one, Make default, New Trunk) and up to 6 features from the feature atlas, each opening its home. The
// window owns them because opening a Trunk, a place or a feature leaves Settings.
import { useEffect, useMemo, useState } from "react";
import type { ConversationList } from "../../connect/conversations";
import type { WindowEngine } from "../../connect/engine";
import type { SaplingSession } from "../../connect/session";
import type { Route } from "../../places-nav/routes";
import { loadRoster, makeDefault } from "../../places/trunk/api";
import { openNewTrunkSheet } from "../../places/trunk/new-trunk-sheet";
import { useTrunks } from "../../shell/engine-data";
import { HOME, loadAtlas, statusWord, type AtlasRow } from "../features/atlas";
import { featureRoute } from "../settings/pages/places-live";
import type { SettingsFrameProps } from "../settings/SettingsFrame";

type Deps = {
  session: SaplingSession;
  engine: WindowEngine;
  ready: boolean;
  list: ConversationList;
  /** Whether Settings is open: the atlas loads only then. */
  open: boolean;
  /** Each Trunk's main conversation key, by agent id, when the list has it. */
  mainKey: (agentId: string) => string | undefined;
  navigate: (route: Route) => void;
  onNotice: (text: string) => void;
};

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useSettingsSearch(d: Deps): Pick<SettingsFrameProps, "trunks" | "features" | "onTrunk" | "onOpenFeature"> {
  const roster = useTrunks(d.session, d.ready);
  const [atlas, setAtlas] = useState<AtlasRow[] | null>(null);
  useEffect(() => {
    if (!d.open || atlas) return;
    let live = true;
    loadAtlas().then((rows) => { if (live) setAtlas(rows); }, () => undefined);
    return () => { live = false; };
  }, [d.open, atlas]);
  const trunks = useMemo(() => (roster.loaded ? roster.list.map((t) => ({ id: t.id, name: t.name, isDefault: t.isDefault })) : undefined), [roster]);
  // The preview names a feature by its title, with its status under it (In Branch, Partly built, Coming).
  const features = useMemo(() => atlas?.map((r) => ({ id: r.id, name: r.f, description: statusWord(r.s) })), [atlas]);
  const { engine, mainKey, navigate, onNotice } = d;
  return {
    trunks,
    features,
    onTrunk: (id, action) => {
      if (action === "open") { navigate({ kind: "chat", key: mainKey(id) ?? `agent:${id}:main` }); return; }
      if (action === "makeDefault") {
        // The same config.patch of agents.defaultId the Trunks page's Make default makes (places/trunk/api makeDefault).
        void loadRoster(engine).then((r) => makeDefault(engine, r, id)).then(
          () => onNotice(`${roster.list.find((t) => t.id === id)?.name ?? "That Trunk"} is your default Trunk now.`),
          (e: unknown) => onNotice(`Couldn’t make it the default: ${why(e)}`));
        return;
      }
      // New Trunk opens the same sheet as the + menu. The chat asks for the job, the model and the tools after Create.
      openNewTrunkSheet();
    },
    onOpenFeature: (id) => {
      const row = atlas?.find((r) => r.id === id);
      const home = row ? HOME[row.a] : undefined;
      navigate(home ? featureRoute(home) : { kind: "settings", page: "features" });
    },
  };
}
