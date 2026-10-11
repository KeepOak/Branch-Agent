// Automations and Canopy render the same live work, with no second board store.
import type { PlaceProps } from "../../places-nav/PlaceFrame";
import { CanopyPlace } from "../canopy";

export function BoardTab(props: PlaceProps) {
  return <CanopyPlace {...props} boardOnly />;
}
