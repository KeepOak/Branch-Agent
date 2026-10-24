export type TopicLayout = "column" | "rail" | "side" | "tabs";
export const topicLayoutNames: Record<TopicLayout, string> = { column: "Column", rail: "Emoji rail", side: "Side tabs", tabs: "Tabs above the chat" };
export const topicLayoutDefaults: Record<TopicLayout, number> = { column: 300, rail: 64, side: 88, tabs: 0 };
export const TOPIC_LAYOUT_KEY = "branch-topics-t5";
export type TopicSettings = { layout: TopicLayout; width: number; per: Record<string, TopicLayout> };

export function readTopicSettings(): TopicSettings {
  try {
    const value = JSON.parse(localStorage.getItem(TOPIC_LAYOUT_KEY) || "null") as Partial<TopicSettings> | null;
    if (value && value.layout && value.layout in topicLayoutNames) return { layout: value.layout, width: typeof value.width === "number" ? value.width : topicLayoutDefaults[value.layout], per: value.per && typeof value.per === "object" && !Array.isArray(value.per) ? value.per : {} };
  } catch { /* Use the preview default when storage is unavailable. */ }
  return { layout: "column", width: 300, per: {} };
}

export function topicLayoutFor(contactId: string): TopicLayout {
  const setting = readTopicSettings();
  return setting.per[contactId] ?? setting.layout;
}

export function saveTopicSettings(setting: TopicSettings) {
  localStorage.setItem(TOPIC_LAYOUT_KEY, JSON.stringify(setting));
  window.dispatchEvent(new Event("branch:topic-layout-changed"));
}

export function setContactTopicLayout(contactId: string, layout: TopicLayout) {
  const setting = readTopicSettings();
  saveTopicSettings({ ...setting, width: topicLayoutDefaults[layout], per: { ...setting.per, [contactId]: layout } });
}

export function setDefaultTopicLayout(layout: TopicLayout, currentContactId?: string) {
  const setting = readTopicSettings();
  const per = { ...setting.per };
  if (currentContactId) delete per[currentContactId];
  saveTopicSettings({ layout, width: topicLayoutDefaults[layout], per });
}

/**
 * R1 offers only the two layouts the owner kept (item 47): Tabs above the chat (the default) and Freedom Mode (owner item 6).
 * Classic keeps the four above. Anything else saved reads as Tabs.
 */
export type R1TopicLayout = "tabs" | "free";
export const r1TopicLayoutNames: Record<R1TopicLayout, string> = { tabs: "Tabs above the chat", free: "Freedom Mode" };

function storedTopicValue(): { layout?: unknown; per?: Record<string, unknown> } {
  try {
    const value = JSON.parse(localStorage.getItem(TOPIC_LAYOUT_KEY) || "null") as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) return value as { layout?: unknown; per?: Record<string, unknown> };
  } catch { /* Storage blocked or damaged: R1 falls back to its default. */ }
  return {};
}

/** Any saved layout R1 does not offer (column, rail, side, a damaged value) reads as Tabs above the chat. */
export function r1LayoutOf(saved: unknown): R1TopicLayout {
  return saved === "free" ? "free" : "tabs";
}

/** The R1 default layout, as Settings shows it. */
export function r1DefaultTopicLayout(): R1TopicLayout {
  return r1LayoutOf(storedTopicValue().layout);
}

/** The R1 layout for one contact: its own saved choice, else the default. */
export function r1TopicLayoutFor(contactId: string): R1TopicLayout {
  const stored = storedTopicValue();
  const per = stored.per && typeof stored.per === "object" ? stored.per : {};
  return r1LayoutOf(contactId in per ? per[contactId] : stored.layout);
}

/** One contact's own R1 layout (its ⋯ › View, preview "<name>’s threads show as" with data-per). */
export function setR1ContactTopicLayout(contactId: string, layout: R1TopicLayout) {
  const stored = storedTopicValue();
  const per = { ...(stored.per ?? {}), [contactId]: layout };
  localStorage.setItem(TOPIC_LAYOUT_KEY, JSON.stringify({ layout: stored.layout ?? "tabs", width: topicLayoutDefaults.tabs, per }));
  window.dispatchEvent(new Event("branch:topic-layout-changed"));
}

/** The R1 default (Settings and the rail's menu). The current contact's own choice is dropped so the default applies to it. */
export function setR1TopicLayout(layout: R1TopicLayout, currentContactId?: string) {
  const per: Record<string, TopicLayout> = { ...(storedTopicValue().per ?? {}) as Record<string, TopicLayout> };
  if (currentContactId) delete per[currentContactId];
  // Written directly: Classic's TopicLayout does not include Freedom Mode, and Classic reads an unknown layout as its default.
  localStorage.setItem(TOPIC_LAYOUT_KEY, JSON.stringify({ layout, width: topicLayoutDefaults.tabs, per }));
  window.dispatchEvent(new Event("branch:topic-layout-changed"));
}
