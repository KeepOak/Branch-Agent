// Seedbank as a place (R1-13): the sidebar's Seedbank pill opens it. Seedbank draws its own title and lede, so it
// sits in the shared place scroller with one hidden h1 for the page, not in PlaceFrame (which would show a second h1).
// Customize's installed things stay one tap away below it (README rule 6): the Tools tab, and each kind's section.
import { PlaceScroll, type PlaceProps } from "../../places-nav/PlaceFrame";
import { Seedbank } from "./Seedbank";

/** The Customize › Tools kinds a Seedbank visitor can open straight away. */
const MANAGE_KINDS = ["Skills", "Connectors", "Plugins", "Command-line tools"] as const;

/** Opens Customize, then its Tools tab (and one kind, when named). Customize listens for the event once it has mounted. */
function openCustomizeTools(openPlace: PlaceProps["openPlace"], tab: string, kind?: string) {
  openPlace("customize");
  setTimeout(() => window.dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "customize", tab: kind ?? tab } })), 0);
}

export function SeedbankPlace({ engine, openPlace }: PlaceProps) {
  return <PlaceScroll>
    <div className="sb-place"><h1 className="sb-sr">Seedbank</h1><Seedbank engine={engine} variant="place" />
      <div className="sb-manage" role="group" aria-label="Manage installed">
        <button type="button" className="sb-btn" onClick={() => openCustomizeTools(openPlace, "Tools")}>Manage installed</button>
        {MANAGE_KINDS.map(kind => <button key={kind} type="button" className="sb-btn" onClick={() => openCustomizeTools(openPlace, "Tools", kind)}>{kind}</button>)}
      </div>
    </div>
  </PlaceScroll>;
}
