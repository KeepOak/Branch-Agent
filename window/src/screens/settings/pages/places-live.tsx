// Settings pages that Classic Settings never had, drawn in the R1 Settings frame with Branch's own R1 screens: Go to
// (every place, one tap away), Seedbank (its Settings view) and All features (the feature atlas). The frame draws each
// page's title, lede and Learn more, as on a row page; these draw only the screen (#1049). The host passes how to go somewhere, so a place,
// another Settings page or a conversation opens in the same window.
import { useEffect, useState } from "react";
import type { PlaceId, Route } from "../../../places-nav/routes";
import { Coming } from "../../../glass/coming";
import { list, record } from "../../../places/settings/adapter";
import { loadNeedsCount } from "../../../places/inbox/data";
import { FEATURES_LEDE, FeaturesPage } from "../../features/FeaturesPage";
import type { FeatureHome } from "../../features/atlas";
import { Seedbank } from "../../seedbank/Seedbank";
import type { WindowEngine } from "../../../connect/engine";
import { COMING_FROM } from "../rows";
import { useLevel } from "../SettingsFrame";
import type { PageSlots } from "../slots";

/** Go to's tiles, in the approved preview's order and words (preview.html Go to, PG goto): each place with its one-line
 *  subtitle. Harvest, Workshop and This computer have no place in this window yet, so their tiles are Coming, and like
 *  every Coming row they show only from Advanced (rows.ts COMING_FROM). */
export const GOTO_TILES: { id: string; name: string; sub: string; place?: PlaceId }[] = [
  { id: "overview", name: "Overview", sub: "Today at a glance", place: "overview" },
  { id: "canopy", name: "Canopy", sub: "Every Trunk’s work, side by side", place: "canopy" },
  { id: "inbox", name: "Inbox", sub: "What needs you, what finished", place: "inbox" },
  { id: "automations", name: "Automations", sub: "What runs by itself", place: "automations" },
  { id: "library", name: "Library", sub: "Files, memory and knowledge", place: "library" },
  { id: "people", name: "People", sub: "Who your Trunks know", place: "people" },
  { id: "customize", name: "Customize", sub: "Trunks, tools, specialists, channels", place: "customize" },
  { id: "harvest", name: "Harvest", sub: "Everything your Trunks made" },
  { id: "grove", name: "Grove", sub: "Your Trunks at their desks", place: "office" },
  { id: "seedbank", name: "Seedbank", sub: "Agents, skills, tools, plugins, connections", place: "seedbank" },
  { id: "workshop", name: "Workshop", sub: "Skill drafts your Trunks proposed" },
  { id: "computer", name: "This computer", sub: "Computers, gateway and battery" },
];
/** The preview's line above the tiles. */
export const GOTO_LEDE = "Every page in Branch, in one place. Each also opens from Ctrl K.";

/** The badges the preview shows: what needs you in the Inbox (as the Inbox counts it) and how many people there are. */
function useBadges(engine: WindowEngine): Record<string, number> {
  const [badges, setBadges] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    loadNeedsCount(engine).then((inbox) => { if (live) setBadges((b) => ({ ...b, inbox })); }, () => undefined);
    engine.request("users.list", {}).then((r) => { if (live) setBadges((b) => ({ ...b, people: list(record(r).profiles).length })); }, () => undefined);
    return () => { live = false; };
  }, [engine]);
  return badges;
}

/** Go to: the preview's line, then every page in Branch, each opening its place. Regular shows only what works today. */
function GoTo({ engine, go }: { engine: WindowEngine; go: (route: Route) => void }) {
  const badges = useBadges(engine);
  const [level] = useLevel(engine);
  const tiles = level < COMING_FROM ? GOTO_TILES.filter((tile) => tile.place) : GOTO_TILES;
  return (
    <div className="r1s-col">
      <p className="r1s-lede g-label" data-lines>{GOTO_LEDE}</p>
      <section className="r1s-sec g-clear" aria-label="Places">
        <ul className="r1s-goto">
          {tiles.map((tile) => {
            const body = <span className="r1s-item-t"><b>{tile.name}{badges[tile.id] ? <em className="r1s-badge" data-need={tile.id === "inbox" ? "sessions.list" : "users.list"}>{badges[tile.id]}</em> : null}</b><small>{tile.sub}</small></span>;
            return (
              <li key={tile.id}>
                {tile.place ? (
                  <button type="button" className="r1s-nav r1s-tile" data-local="" data-place={tile.place} onClick={() => go({ kind: "place", place: tile.place! })}>{body}</button>
                ) : (
                  <Coming engine={engine} need={`window: the ${tile.name} place`} unwired show reason={`${tile.name} comes in a later update.`} where={tile.name}>
                    <button type="button" className="r1s-nav r1s-tile" data-tile={tile.id}>{body}</button>
                  </Coming>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

/** The route a feature's home opens. */
export function featureRoute(home: FeatureHome): Route {
  if (home.kind === "settings") return { kind: "settings", page: home.page };
  if (home.kind === "place") return { kind: "place", place: home.place };
  return { kind: "chat", key: null };
}

/** Opens a feature's home. A place home that names a tab goes out as a navigate-place request, which carries the tab. */
export function openFeature(home: FeatureHome, go: (route: Route) => void): void {
  if (home.kind === "place" && home.tab) window.dispatchEvent(new CustomEvent("branch:navigate-place", { detail: { place: home.place, tab: home.tab } }));
  else go(featureRoute(home));
}

/** All features: the atlas, with Technical areas shown when "How much to show" is Technical. */
function Features({ engine, go }: { engine: WindowEngine; go: (route: Route) => void }) {
  const [level] = useLevel(engine);
  return (
    <>
      <p className="r1s-lede g-label r1s-features-lede" data-lines>{FEATURES_LEDE}</p>
      <FeaturesPage technical={level === 2} onOpen={(home) => openFeature(home, go)} />
    </>
  );
}

/** The pages above, for a host that can go to a route. */
export function placePages(go: (route: Route) => void): PageSlots {
  return {
    goto: { component: ({ engine }) => <GoTo engine={engine} go={go} /> },
    seedbank: { component: ({ engine }) => <Seedbank engine={engine} variant="settings" /> },
    features: { component: ({ engine }) => <Features engine={engine} go={go} /> },
  };
}
