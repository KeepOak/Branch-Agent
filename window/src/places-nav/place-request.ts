// A "branch:navigate-place" request: the place it names and the tab to open on. Places are asked for by id; a request
// that names no place of ours is ignored. The tab is optional, and a place opens on its default tab without one.
import type { PlaceId } from "./routes";

export type PlaceRequest = { place: PlaceId; tab?: string };

/** The request a navigate-place event carries, or null when it names no place in `places`. */
export function placeRequest(detail: unknown, places: readonly PlaceId[]): PlaceRequest | null {
  const { place, tab } = (detail && typeof detail === "object" ? detail : {}) as { place?: unknown; tab?: unknown };
  if (typeof place !== "string" || !(places as readonly string[]).includes(place)) return null;
  return typeof tab === "string" && tab ? { place: place as PlaceId, tab } : { place: place as PlaceId };
}
