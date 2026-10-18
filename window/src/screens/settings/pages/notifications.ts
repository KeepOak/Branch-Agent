// Settings › Notifications: the rows of the R1 page, in the approved preview's nine cards (preview.html PG notifications).
// Every working control of Classic Notifications (set1/notifications*.tsx) is a "slot" row drawn by the page
// (notifications-live.tsx) on the same calls: your defaults in users.prefs (notifications.web.v1), this computer's own
// choices and push subscription through push.web.*, and a test through push.web.test. A row the preview has and Branch
// can't do yet is a Coming row that says only that it comes later; the call it waits for stays in its need.
import type { Level } from "../nav";
import type { Control, Row, RowOption } from "../rows";

type Extra = { help?: string; level?: Level; control?: Control; options?: RowOption[]; bare?: true };
const coming = (id: string, card: string, label: string, need: string, extra: Extra = {}): Row =>
  ({ id, page: "notifications", card, label, level: 0, control: "custom", ...extra, source: { kind: "coming", need, reason: `${label} comes in a later update.` } });
const slot = (id: string, card: string, label: string | undefined, calls: string[], extra: Extra = {}): Row =>
  ({ id, page: "notifications", card, ...(label ? { label } : {}), level: 0, control: "custom", ...extra, source: { kind: "slot", calls, reason: `${label ?? "This"} comes in a later update.` } });

export const TELL = "Tell me when…";
const PREFS = ["users.prefs.get", "users.prefs.set"];
const DEVICE = ["push.web.preferences.get", "push.web.preferences.set"];
const KIND = "engine: kinds of notice";
const ON_OFF: RowOption[] = [{ v: "def", label: "Use my default" }, { v: "on", label: "On" }, { v: "off", label: "Off" }];

/** Your defaults' kinds of notice (Classic TELL), with the preview's words. */
export const CATEGORIES: [key: string, label: string, help: string][] = [
  ["approvalRequested", "A Trunk needs a yes", "Shows on this computer and your phone."],
  ["agentQuestion", "A Trunk asks you something", "A question it can’t go on without. Off until you turn it on."],
  ["agentFinished", "A long task finishes", "When a Trunk finishes its work."],
  ["scheduledTaskFailed", "An automation fails", "When a scheduled job can’t finish. Off until you turn it on."],
  ["humanMentioned", "Someone mentions you", "When someone picks you with @ in a conversation you share. Off until you turn it on."],
];
const cat = (key: string) => { const [, label, help] = CATEGORIES.find((c) => c[0] === key)!; return slot(`notifications.tell.${key}`, TELL, label, PREFS, { control: "toggle", help }); };
const pcCat = (key: string) => { const [, label] = CATEGORIES.find((c) => c[0] === key)!; return slot(`notifications.pc.${key}`, "This PC", label, DEVICE, { control: "select", level: 1 }); };

export const NOTIFICATIONS_ROWS: Row[] = [
  // Tell me when…
  // Preview TELL_PE18 builds this switch's title at render time, so preview.html has no static label to copy. Draw the row without one.
  slot("notifications.tell.here", TELL, undefined, ["push.web.preferences.set"], { control: "toggle", help: "Off keeps this device quiet; your other devices still get them.", bare: true }),
  cat("approvalRequested"), cat("agentQuestion"), cat("agentFinished"),
  coming("notifications.tell.replies", TELL, "A Trunk replies", KIND, { control: "toggle", help: "Only while Branch isn’t in front." }),
  coming("notifications.tell.stops", TELL, "Something stops working", KIND, { control: "toggle", help: "A chat app, an automation, the connection or the sealed box." }),
  coming("notifications.tell.sends", TELL, "A Trunk sends a notification", KIND, { control: "toggle", help: "When a Trunk decides you should know something now." }),
  cat("scheduledTaskFailed"), cat("humanMentioned"),
  coming("notifications.tell.sound", TELL, "Play a sound", "engine: a notification sound", { control: "toggle", help: "A short sound: the system’s own, or Branch’s chime (Advanced › Which sound)." }),
  coming("notifications.tell.device-asks", TELL, "A device asks to connect: open a window to answer", "desktop: opening a window for a pairing request",
    { control: "toggle", level: 1, help: "Off: the request waits in the Inbox and in a notification." }),
  slot("notifications.tell.trunks", TELL, "Only these Trunks", [...PREFS, "agents.list"], { level: 1, help: "Notifications from other Trunks still reach the Inbox." }),
  slot("notifications.tell.locked", TELL, "On a locked screen", PREFS, { level: 1, control: "segmented", help: "Message text, commands and output never go in a notification." }),
  coming("notifications.tell.which-sound", TELL, "Which sound", "engine: a notification sound", { level: 1, control: "segmented",
    options: [{ v: "system", label: "The system’s sound" }, { v: "chime", label: "Branch’s chime" }], help: "The system’s sound is your computer’s own notification sound." }),
  coming("notifications.tell.recent", TELL, "Recent notifications", "window: a list of recent notifications", { level: 1, help: "The last 100 Branch showed on this device, after they leave the screen." }),
  slot("notifications.tell.test", TELL, "Send a test notification", ["push.web.test"]),

  // Quiet
  slot("notifications.quiet.hours", "Quiet", "Quiet hours", PREFS, { help: "Approvals still wait in the Inbox; nothing pings you in these hours." }),
  slot("notifications.quiet.zone", "Quiet", "Time zone", PREFS, { control: "select", help: "So quiet hours hold when your phone is in another time zone." }),
  coming("notifications.quiet.days", "Quiet", "Days off", "engine: days off", { control: "segmented",
    options: [{ v: "sat", label: "Sat" }, { v: "sun", label: "Sun" }, { v: "none", label: "None" }], help: "No notifications at all on these days." }),

  // When work stalls, Live activity
  coming("notifications.stalls.stopped", "When work stalls", "A conversation stopped moving", "engine: a stalled-work notice",
    { control: "toggle", help: "Once, when a Trunk has something to do but has made no progress for a while." }),
  coming("notifications.live.pill", "Live activity", "Live activity at the top of the screen (Mac)", "desktop: the menu bar pill",
    { control: "toggle", help: "A small pill under the menu bar shows each working Trunk’s current step; it opens when one needs you." }),

  // Kinds of notice (Advanced), Sorting (Technical)
  ...["Health", "Urgent", "Reminders", "Email", "Calendar", "Builds", "Stocks", "Everything else"].map((k) =>
    coming(`notifications.kinds.${k.toLowerCase().replace(/ /g, "-")}`, "Kinds of notice", k, KIND, { control: "toggle", level: 1, help: "Follows you on every device." })),
  coming("notifications.sorting.trunk-kind", "Sorting", "Use the kind a Trunk gives", KIND, { control: "toggle", level: 2,
    help: "When a Trunk marks a notice urgent, a reminder and so on, that wins over your rules." }),
  coming("notifications.sorting.rule", "Sorting", "Add a rule", KIND, { level: 2 }),

  // This PC (Advanced): this computer's own choices; "Use my default" leaves your defaults in charge.
  slot("notifications.pc.name", "This PC", "Name on its notifications", DEVICE, { control: "text", level: 1, help: "Changes only this device. Your defaults above stay." }),
  slot("notifications.pc.locked", "This PC", "On a locked screen", DEVICE, { control: "select", level: 1 }),
  slot("notifications.pc.quiet", "This PC", "Quiet hours", DEVICE, { control: "select", level: 1 }),
  slot("notifications.pc.trunks", "This PC", "Only these Trunks", [...DEVICE, "agents.list"], { control: "select", level: 1 }),
  pcCat("approvalRequested"), pcCat("agentQuestion"), pcCat("agentFinished"),
  ...["A Trunk replies", "Something stops working", "A Trunk sends a notification"].map((label) =>
    coming(`notifications.pc.${label.toLowerCase().replace(/[^a-z]+/g, "-")}`, "This PC", label, KIND, { control: "select", level: 1, options: ON_OFF })),
  pcCat("scheduledTaskFailed"), pcCat("humanMentioned"),
  coming("notifications.pc.sound", "This PC", "Play a sound", "engine: a notification sound", { control: "select", level: 1, options: ON_OFF }),

  // Send events to a web address, Web Push
  coming("notifications.hook.address", "Send events to a web address", "Address", "engine: sending events to a web address",
    { control: "text", help: "Discord, Slack, or any app that accepts messages." }),
  coming("notifications.hook.events", "Send events to a web address", "Events", "engine: sending events to a web address"),
  coming("notifications.push.phone", "Web Push", "Push to your phone", "engine: push to the Branch app on a phone",
    { control: "toggle", help: "Notices reach the Branch app on your phone even when this window is closed." }),
  slot("notifications.push.browser", "Web Push", "Push to this browser", ["push.web.vapidPublicKey", "push.web.subscribe", "push.web.unsubscribe"],
    { control: "toggle", help: "Uses the browser’s own Web Push. Only an encrypted notice leaves this computer." }),
];
