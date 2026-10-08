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
