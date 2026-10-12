import type { Topic } from "@branch/gateway-protocol";

export type TopicMode = "flat" | "time" | "project" | "status";
export type TopicListItem = { topic: Topic; updatedAt: number; preview: string; projectName?: string };
export type TopicGroup = { label: string; items: TopicListItem[] };

/** LobeHub's flat / by-time / by-project / by-status topic modes, scoped to one contact. */
export function groupContactTopics(items: readonly TopicListItem[], mode: TopicMode, query: string, now = Date.now()): TopicGroup[] {
  const needle = query.trim().toLocaleLowerCase();
  const shown = items.filter(({ topic, preview }) => !needle || `${topic.title} ${preview}`.toLocaleLowerCase().includes(needle))
    .sort((a, b) => Number(Boolean(b.topic.pinnedAt)) - Number(Boolean(a.topic.pinnedAt)) || b.updatedAt - a.updatedAt || a.topic.title.localeCompare(b.topic.title));
  if (mode === "flat" || needle) return [{ label: "", items: shown }];
  const label = (item: TopicListItem): string => {
    if (mode === "project") return item.projectName || (item.topic.projectId ? "Other project" : "No project");
    if (mode === "status") return item.topic.status[0]!.toUpperCase() + item.topic.status.slice(1);
    const day = new Date(item.updatedAt).toDateString();
    if (day === new Date(now).toDateString()) return "Today";
    if (day === new Date(now - 86400000).toDateString()) return "Yesterday";
    if (item.updatedAt >= now - 7 * 86400000) return "This week";
    return "Earlier";
  };
  const groups = new Map<string, TopicListItem[]>();
  for (const item of shown) groups.set(label(item), [...(groups.get(label(item)) ?? []), item]);
  return [...groups].map(([name, rows]) => ({ label: name, items: rows }));
}
