// The conversation's browser route (where its browser runs and which profile), and the browser.request calls
// the stage makes on it. Copied from window/src/stage/browser-route.ts and wired to the phone's EngineLink.
// Before the first tool call, use only Branch's managed browser, never the user's Chrome.
import type { EngineLink } from "../pairing/pairingSession";

export type BrowserRoute = { target: "host"; profile: string } | { target: "node"; node: string; profile: string };
export type LiveTab = { targetId: string; title: string; url: string };

/** Branch's own managed browser on this computer, used until a conversation records a different route. */
export const DEFAULT_BROWSER_ROUTE: BrowserRoute = { target: "host", profile: "branch" };

export const routeKey = (route: BrowserRoute | null) => (route ? JSON.stringify([route.target, "node" in route ? route.node : undefined, route.profile]) : "");

/** One browser.request on the route. targetId goes in the query for GET and in the body otherwise. */
export function browserCall<T = unknown>(
  link: EngineLink,
  route: BrowserRoute,
  method: "GET" | "POST" | "DELETE",
  path: string,
  options: { targetId?: string; query?: Record<string, unknown>; body?: Record<string, unknown>; sessionKey?: string } = {},
): Promise<T> {
  const target = options.targetId ? { targetId: options.targetId } : {};
  return link.request<T>("browser.request", {
    target: route.target,
    ...(route.target === "node" ? { node: route.node } : {}),
    method,
    path,
    query: { profile: route.profile, ...(method === "GET" ? target : {}), ...options.query },
    ...(method === "POST" ? { body: { ...options.body, ...target } } : {}),
    ...(options.sessionKey ? { tabScope: { sessionKey: options.sessionKey } } : {}),
  });
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** GET /tabs, read into the page tabs this conversation may see. */
export function readTabs(result: unknown): LiveTab[] {
  const tabs = rec(result).tabs;
  return (Array.isArray(tabs) ? tabs : [])
    .map(rec)
    .filter((t) => str(t.targetId) && (t.type === undefined || t.type === "page"))
    .map((t) => ({ targetId: str(t.targetId), title: str(t.title), url: str(t.url) }));
}

/** The words under the title: the managed profile is Branch's own browser; another profile is named. */
export function profileLine(route: BrowserRoute | null): string {
  if (!route) return "";
  const own = route.profile === "branch";
  return own ? "Branch’s own browser · its own profile" : `The browser’s ${route.profile} profile`;
}
