// Where the window can be (DESIGN-SPEC §3.3 saved layout, §4.6 Places, §4.7 Settings): a conversation,
// one of the seven places, or a Settings page. The last route is kept on this computer and reopened at launch.
import type { IconName } from "../shell/icons";

export type PlaceId = "overview" | "canopy" | "inbox" | "automations" | "library" | "people" | "customize" | "office";

export type Route =
  | { kind: "chat"; key: string | null }
  | { kind: "place"; place: PlaceId }
  | { kind: "settings"; page: string };

/** The seven places, in the sidebar's order (§4.1.1 Place rows). */
export const PLACES: { id: PlaceId; name: string; icon: IconName }[] = [
  { id: "overview", name: "Overview", icon: "home" },
  { id: "canopy", name: "Canopy", icon: "panel" },
  { id: "inbox", name: "Inbox", icon: "inbox" },
  { id: "automations", name: "Automations", icon: "clock" },
  { id: "library", name: "Library", icon: "book" },
  { id: "people", name: "People", icon: "users" },
  { id: "customize", name: "Customize", icon: "sliders" },
];

const KEY = "branch.route";

export function isPlace(id: string): id is PlaceId {
  return id === "office" || PLACES.some((p) => p.id === id);
}

export function parseRoute(raw: string | null): Route | null {
  if (!raw) {
    return null;
  }
  try {
    const r = JSON.parse(raw) as Record<string, unknown>;
    if (r.kind === "chat") {
      return { kind: "chat", key: typeof r.key === "string" ? r.key : null };
    }
    if (r.kind === "place" && typeof r.place === "string" && isPlace(r.place)) {
      return { kind: "place", place: r.place };
    }
    if (r.kind === "settings" && typeof r.page === "string") {
      return { kind: "settings", page: r.page };
    }
    return null;
  } catch {
    return null; // a damaged saved route reopens the default Trunk's conversation
  }
}

export function loadRoute(): Route {
  // A window opened with "Open in its own window" (or a copied conversation link) names its conversation.
  const asked = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("conversation");
  if (asked) {
    try { return parseRoute(sessionStorage.getItem(KEY)) ?? { kind: "chat", key: asked }; }
    catch { return { kind: "chat", key: asked }; }
  }
  try {
    return parseRoute(localStorage.getItem(KEY)) ?? { kind: "chat", key: null };
  } catch {
    return { kind: "chat", key: null }; // storage blocked
  }
}

export function saveRoute(route: Route): void {
  try {
    const dedicated = typeof location !== "undefined" && new URLSearchParams(location.search).has("conversation");
    (dedicated ? sessionStorage : localStorage).setItem(KEY, JSON.stringify(route));
  } catch {
    // storage blocked: the window reopens on the default Trunk's conversation
  }
}

/** The window title (§3.2 Parity adds, document-title-status): "<page> — Branch", with "(N) " or "(Offline) " in front. */
export function windowTitle(page: string, waiting: number, offline: boolean): string {
  const prefix = offline ? "(Offline) " : waiting > 0 ? `(${waiting}) ` : "";
  return `${prefix}${page ? `${page} — ` : ""}Branch`;
}
