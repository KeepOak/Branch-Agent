// The conversation's browser route (where its browser runs and which profile). Prefer the route recorded by
// tool steps; when none exists, fall back to Branch's own host browser so a new conversation can still browse.
import type { WindowEngine } from "../connect/engine";
import type { Block } from "../thread/model";
import { browserTabKey, type BrowserPresentation, type BrowserTabTarget } from "../thread/browser-presentation";

export type BrowserRoute = Omit<BrowserTabTarget, "targetId">;
export type LiveTab = { targetId: string; title: string; url: string };

/** Branch's own host browser and managed profile (engine DEFAULT_BROWSER_DEFAULT_PROFILE_NAME). */
export const HOST_BROWSER_ROUTE: BrowserRoute = { target: "host", profile: "branch" };

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const LOOKS_LIKE_HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/** Chromium's default search URL shape; the engine has no separate omnibox search setting. */
export const DEFAULT_SEARCH_URL = "https://www.google.com/search?q=";

/** Address bar: a scheme is kept, a host-like value gets https://, anything else is a web search. */
export function addressBarUrl(raw: string): string {
  const target = raw.trim();
  if (!target) return "";
  if (HAS_SCHEME.test(target)) return target;
  const host = target.split(/[/?#]/)[0] ?? "";
  if (LOOKS_LIKE_HOST.test(host)) return `https://${target}`;
  return `${DEFAULT_SEARCH_URL}${encodeURIComponent(target)}`;
}

/** A new tab the person (or fallback) just opened: no page yet. */
export function isBlankTab(url: string | undefined): boolean {
  return !url || url === "about:blank";
}

/** Each recorded tab once, newest last. */
export function recordedBrowserTabs(blocks: Block[]): BrowserPresentation[] {
  const tabs = new Map<string, BrowserPresentation>();
  for (const block of blocks)
    if (block.kind === "step" && block.status === "ok" && block.browser) {
      const key = browserTabKey(block.browser.tab);
      tabs.delete(key);
      tabs.set(key, block.browser);
    }
  return [...tabs.values()];
}

/** The route of the newest recorded tab: the browser this conversation actually used. */
export function routeOf(entries: BrowserPresentation[]): BrowserRoute | null {
  const tab = entries.at(-1)?.tab;
  if (!tab) return null;
  return tab.target === "node" ? { target: "node", node: tab.node, profile: tab.profile } : { target: "host", profile: tab.profile };
}

/** Recorded route when the conversation used a browser; otherwise Branch's own host browser. */
export function activeRoute(entries: BrowserPresentation[]): BrowserRoute {
  return routeOf(entries) ?? HOST_BROWSER_ROUTE;
}

export const routeKey = (route: BrowserRoute | null) => (route ? JSON.stringify([route.target, route.node, route.profile]) : "");

/** One browser.request on the route, scoped to this conversation's tabs. targetId goes in the query for GET and in the body otherwise. */
export function browserCall<T = unknown>(
  engine: WindowEngine,
  route: BrowserRoute,
  method: "GET" | "POST" | "DELETE",
  path: string,
  options: { targetId?: string; query?: Record<string, unknown>; body?: Record<string, unknown> } = {},
): Promise<T> {
  const target = options.targetId ? { targetId: options.targetId } : {};
  return engine.request<T>("browser.request", {
    target: route.target,
    ...(route.target === "node" ? { node: route.node } : {}),
    method,
    path,
    query: { profile: route.profile, ...(method === "GET" ? target : {}), ...options.query },
    ...(method === "POST" ? { body: { ...options.body, ...target } } : {}),
    tabScope: { sessionKey: engine.sessionKey },
  });
}

// Equivalent to bindBrowserRequestClient's routed tabScope envelope. Every operation stays on the complete route
// recorded by this conversation's tool.
export function scopedBrowserRequest(engine: WindowEngine, entry: BrowserPresentation, method: "GET" | "POST", path: string, body?: Record<string, unknown>) {
  return engine.request("browser.request", {
    target: entry.tab.target,
    ...(entry.tab.target === "node" ? { node: entry.tab.node } : {}),
    method,
    path,
    query: { profile: entry.tab.profile },
    ...(body ? { body: { ...body, targetId: entry.tab.targetId } } : {}),
    tabScope: { sessionKey: engine.sessionKey },
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
