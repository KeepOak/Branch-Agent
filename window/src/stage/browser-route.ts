// The conversation's browser route (where its browser runs and which profile), taken only from tool steps the
// engine recorded, and the browser.request calls the stage makes on it. Never a guessed route.
import type { WindowEngine } from "../connect/engine";
import type { Block } from "../thread/model";
import { browserTabKey, type BrowserPresentation, type BrowserTabTarget } from "../thread/browser-presentation";

export type BrowserRoute = Omit<BrowserTabTarget, "targetId">;
export type LiveTab = { targetId: string; title: string; url: string };

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
