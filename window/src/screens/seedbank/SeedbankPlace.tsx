// Seedbank as a place (R1-13): the sidebar's Seedbank pill opens it. Seedbank draws its own title and lede, so it
// sits in the shared place scroller with one hidden h1 for the page, not in PlaceFrame (which would show a second h1).
import { PlaceScroll, type PlaceProps } from "../../places-nav/PlaceFrame";
import { Seedbank } from "./Seedbank";

export function SeedbankPlace({ engine }: PlaceProps) {
  return <PlaceScroll>
    <div className="sb-place"><h1 className="sb-sr">Seedbank</h1><Seedbank engine={engine} variant="place" /></div>
  </PlaceScroll>;
}
