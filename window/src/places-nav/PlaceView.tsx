import { lazy, Suspense } from "react";
import { AutomationsPlace } from "../places/automations";
import { CanopyPlace } from "../places/canopy";
import { CustomizePlace } from "../places/customize";
import { CustomizeR1Place } from "../places/customize/r1-place";
import { InboxPlace } from "../places/inbox";
import { LibraryPlace } from "../places/library";
import { OverviewPlace } from "../places/overview";
import { PeoplePlace } from "../places/people";
import { SeedbankPlace } from "../screens/seedbank/SeedbankPlace";
import { useLevel } from "./level";
import { TrunkHost } from "./TrunkHost";
import type { PlaceProps } from "./PlaceFrame";
import type { PlaceId } from "./routes";

const OfficePlace = lazy(() => import("../places/office").then(m => ({ default: m.OfficePlace })));

type Mount = (p: PlaceProps & { usePrompt?: (text: string) => void }) => React.ReactNode;
const MOUNTS: Record<PlaceId, Mount> = {
  overview: OverviewPlace,
  canopy: CanopyPlace,
  inbox: InboxPlace,
  automations: AutomationsPlace,
  library: LibraryPlace,
  people: PeoplePlace,
  customize: CustomizePlace,
  office: OfficePlace,
  seedbank: SeedbankPlace,
};

/** The R1 window mounts Customize from places/customize/r1-place.tsx; Classic keeps CustomizePlace (its tabs stay). */
const R1_MOUNTS: Partial<Record<PlaceId, Mount>> = { customize: CustomizeR1Place };

/** Routes to a place's mount point (window/src/places/<place>/index.tsx). Preview enter11: only the place remounts. */
export function PlaceView({ place, r1 = false, usePrompt, ...props }: Omit<PlaceProps, "level"> & { place: PlaceId; r1?: boolean; usePrompt?: (text: string) => void }) {
  const Mount = (r1 && R1_MOUNTS[place]) || MOUNTS[place];
  const level = useLevel();
  return (
    <>
      <div className="enter11" key={place}>
        <Suspense fallback={<p role="status">Opening the office…</p>}><Mount {...props} level={level} usePrompt={usePrompt} /></Suspense>
      </div>
      <TrunkHost engine={props.engine} level={level} openSettings={props.openSettings} openPlace={props.openPlace} openConversation={props.openConversation} />
    </>
  );
}
