// Adapted from engine/ui/src/components/browser/browser-target.ts and
// engine/ui/src/lib/chat/tool-cards.ts. Partial descriptors never get a guessed route.
export type BrowserTabTarget = { targetId: string; profile: string } & (
  | { target: "host"; node?: never }
  | { target: "node"; node: string }
);
export type BrowserPresentation = {
  tab: BrowserTabTarget;
  revision: string;
  url?: string;
  title?: string;
};
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const identifier = (v: unknown, max = 128): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= max && v.trim() === v;
export function readBrowserTabTarget(value: unknown): BrowserTabTarget | undefined {
  const tab = record(value);
  if (!identifier(tab.targetId) || !identifier(tab.profile)) return;
  const identity = { targetId: tab.targetId, profile: tab.profile };
  if (tab.target === "host" && tab.node === undefined) return { ...identity, target: "host" };
  if (tab.target === "node" && identifier(tab.node, 256))
    return { ...identity, target: "node", node: tab.node };
}
export function readBrowserPresentation(
  result: unknown,
  tool: string,
  revision: string,
): BrowserPresentation | undefined {
  if (tool !== "browser" && !tool.endsWith("__browser")) return;
  const details = record(record(result).details),
    raw = record(details.browserTab),
    tab = readBrowserTabTarget(raw);
  if (!tab || !revision) return;
  let url: string | undefined;
  try {
    if (typeof raw.url === "string" && ["http:", "https:"].includes(new URL(raw.url).protocol))
      url = raw.url.slice(0, 2048);
  } catch {
    /* No navigable URL is claimed. */
  }
  return {
    tab,
    revision,
    ...(url ? { url } : {}),
    ...(typeof raw.title === "string" ? { title: raw.title.slice(0, 512) } : {}),
  };
}
export const browserTabKey = (tab: BrowserTabTarget) =>
  JSON.stringify([tab.target, tab.node, tab.profile, tab.targetId]);
