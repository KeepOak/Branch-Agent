import type { Row } from "../settings";

/** Public row descriptors, merged into Settings navigation by stable id. */
export const CHAT_APP_ROWS: Row[] = [
  { id: "chatapps.replies.typing", page: "chatapps", card: "How replies look & arrive", label: "Show typing", level: 0, control: "select", source: { kind: "config", path: "agents.defaults.typingMode" }, options: [{ v: "instant", label: "Right away" }, { v: "thinking", label: "While thinking" }, { v: "message", label: "When it writes" }, { v: "never", label: "Never" }] },
  { id: "chatapps.replies.parts", page: "chatapps", card: "How replies look & arrive", label: "Long replies", level: 0, control: "select", source: { kind: "config", path: "agents.defaults.blockStreamingDefault" }, options: [{ v: "on", label: "In parts" }, { v: "off", label: "All at once" }] },
  { id: "chatapps.groups.policy", page: "chatapps", card: "Groups", label: "Groups, for every app", help: "An app’s own choice wins.", level: 0, control: "select", source: { kind: "config", path: "channels.defaults.groupPolicy" }, options: [{ v: "allowlist", label: "Groups I approve" }, { v: "open", label: "Any group" }, { v: "disabled", label: "No groups" }] },
  { id: "chatapps.commands.native", page: "chatapps", card: "Commands", label: "Commands in the app’s menu", level: 0, control: "select", source: { kind: "config", path: "commands.native" }, options: [{ v: "auto", label: "Auto" }, { v: true, label: "On" }, { v: false, label: "Off" }] },
  { id: "chatapps.commands.text", page: "chatapps", card: "Commands", label: "Typed commands", level: 0, control: "toggle", source: { kind: "config", path: "commands.text" } },
  { id: "chatapps.approvals.enabled", page: "chatapps", card: "Approvals & what Trunks may do", label: "Send command approvals to chat apps", level: 0, control: "toggle", source: { kind: "config", path: "approvals.exec.enabled" } },
  { id: "chatapps.limits.queue", page: "chatapps", card: "Limits & quiet", label: "Hold up to", unit: "messages", level: 0, control: "number", source: { kind: "config", path: "messages.queue.cap" } },
];
export const TELEGRAM_ADAPTER: Row = { id: "chatapps.telegram.adapter", page: "chatapps", card: "Behaviour", label: "Default adapter", level: 0, control: "custom", source: { kind: "coming", need: "channel.adapters", reason: "Adapters arrive after release." } };
