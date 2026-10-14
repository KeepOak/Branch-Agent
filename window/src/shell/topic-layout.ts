// "Threads show as" (owner item 47, preview.html "item 47"): Tabs above the chat, the default, and Freedom Mode only.
// Column, Emoji rail and Side tabs are gone; a saved removed layout (the default or one contact's) falls back to Tabs.
// Freedom Mode draws the threads as a column the person resizes freely (preview item 6).
export type TopicLayout = "tabs" | "free";
export const topicLayoutNames: Record<TopicLayout, string> = { tabs: "Tabs above the chat", free: "Freedom Mode" };
export const topicLayoutDefaults: Record<TopicLayout, number> = { tabs: 0, free: 300 };
const isLayout = (value: unknown): value is TopicLayout => value === "tabs" || value === "free";
export const TOPIC_LAYOUT_KEY = "branch-topics-t5";
export type TopicSettings = { layout: TopicLayout; width: number; per: Record<string, TopicLayout> };

export function readTopicSettings(): TopicSettings {
  try {
    const value = JSON.parse(localStorage.getItem(TOPIC_LAYOUT_KEY) || "null") as Partial<TopicSettings> | null;
    if (value && typeof value === "object") {
      const layout = isLayout(value.layout) ? value.layout : "tabs";
      const per: Record<string, TopicLayout> = {};
      if (value.per && typeof value.per === "object" && !Array.isArray(value.per)) for (const [id, v] of Object.entries(value.per)) per[id] = isLayout(v) ? v : "tabs";
      return { layout, width: isLayout(value.layout) && typeof value.width === "number" ? value.width : topicLayoutDefaults[layout], per };
    }
  } catch { /* Use the preview default when storage is unavailable. */ }
  return { layout: "tabs", width: topicLayoutDefaults.tabs, per: {} };
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
