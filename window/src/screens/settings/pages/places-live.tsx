// Settings pages that Classic Settings never had, drawn in the R1 Settings frame with Branch's own R1 screens: Go to
// (every place, one tap away), Seedbank (its Settings view) and All features (the feature atlas). Each draws the page's
// title and lede from nav.ts, as a row page does, then the screen. The host passes how to go somewhere, so a place,
// another Settings page or a conversation opens in the same window.
import { PLACES, type Route } from "../../../places-nav/routes";
import { Icon } from "../../../shell/icons";
import { FeaturesPage } from "../../features/FeaturesPage";
import type { FeatureHome } from "../../features/atlas";
import { Seedbank } from "../../seedbank/Seedbank";
import type { WindowEngine } from "../../../connect/engine";
import { PAGES, type PageId } from "../nav";
import { useLevel } from "../SettingsFrame";
import type { PageSlots } from "../slots";

function Head({ page }: { page: PageId }) {
  const spec = PAGES[page];
  return (
    <header className="r1s-head">
      <h1 className="g-label">{spec.title}</h1>
      <p className="r1s-lede g-label" data-lines>{spec.lede}</p>
    </header>
  );
}

/** Go to: every place in the sidebar's order, each opening that place. */
function GoTo({ go }: { go: (route: Route) => void }) {
  return (
    <>
      <Head page="goto" />
      <div className="r1s-col"><section className="r1s-sec g-clear" aria-label="Places">
        <ul className="r1s-goto">
          {PLACES.map((place) => (
            <li key={place.id}>
              <button type="button" className="r1s-nav" data-local="" data-place={place.id} onClick={() => go({ kind: "place", place: place.id })}>
                <Icon name={place.icon} size={16} /><span>{place.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </section></div>
    </>
  );
}

/** The route a feature's home opens. */
export function featureRoute(home: FeatureHome): Route {
  if (home.kind === "settings") return { kind: "settings", page: home.page };
  if (home.kind === "place") return { kind: "place", place: home.place };
  return { kind: "chat", key: null };
}

/** All features: the atlas, with Technical areas shown when "How much to show" is Technical. */
function Features({ engine, go }: { engine: WindowEngine; go: (route: Route) => void }) {
  const [level] = useLevel(engine);
  return (
    <>
      <Head page="features" />
      <FeaturesPage technical={level === 2} onOpen={(home) => go(featureRoute(home))} />
    </>
  );
}

/** The pages above, for a host that can go to a route. */
export function placePages(go: (route: Route) => void): PageSlots {
  return {
    goto: { component: () => <GoTo go={go} /> },
    seedbank: { component: ({ engine }) => <><Head page="seedbank" /><Seedbank engine={engine} variant="settings" /></> },
    features: { component: ({ engine }) => <Features engine={engine} go={go} /> },
  };
}
