import { lazy, Suspense } from "react";
import { AutomationsPlace } from "../places/automations";
import { CanopyPlace } from "../places/canopy";
import { CustomizePlace } from "../places/customize";
import { InboxPlace } from "../places/inbox";
import { LibraryPlace } from "../places/library";
import { OverviewPlace } from "../places/overview";
import { PeoplePlace } from "../places/people";
import { useLevel } from "./level";
import { TrunkHost } from "./TrunkHost";
import type { PlaceProps } from "./PlaceFrame";
import type { PlaceId } from "./routes";

const OfficePlace = lazy(() => import("../places/office").then(m => ({ default: m.OfficePlace })));

const MOUNTS: Record<PlaceId, (p: PlaceProps) => React.ReactNode> = {
  overview: OverviewPlace,
  canopy: CanopyPlace,
  inbox: InboxPlace,
  automations: AutomationsPlace,
  library: LibraryPlace,
  people: PeoplePlace,
  customize: CustomizePlace,
  office: OfficePlace,
};

/** Routes to a place's mount point (window/src/places/<place>/index.tsx). */
export function PlaceView({ place, ...props }: Omit<PlaceProps, "level"> & { place: PlaceId }) {
  const Mount = MOUNTS[place];
  const level = useLevel();
  return (
    <>
      <Suspense fallback={<p role="status">Opening the office…</p>}><Mount {...props} level={level} /></Suspense>
      <TrunkHost engine={props.engine} level={level} openSettings={props.openSettings} openPlace={props.openPlace} />
    </>
  );
}
