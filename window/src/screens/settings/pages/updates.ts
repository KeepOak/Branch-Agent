// Settings › Updates & about: the approved preview's ten cards (preview.html PG updates), in order. Each Classic Updates
// section is drawn inside its card without its Classic heading (Help and updates, more and Technical fold into
// Updating); Achievements is one card with the tier counts and badges; Shortcuts, guide & apps is the preview's row of
// buttons (updates-live.tsx).
import type { Row } from "../rows";

const block = (id: string, card: string, label: string, level: 0 | 1 | 2, calls: string[]): Row =>
  ({ id, page: "updates", card, label, level, control: "custom", bare: true, source: { kind: "slot", calls, reason: `${label} comes in a later update.` } });

export const UPDATES_ROWS: Row[] = [
  block("updates.updating.block", "Updating", "Check for updates", 0, ["update.status", "update.run", "config.get", "config.patch"]),
  block("updates.devices.block", "Branch on your other devices", "Already have the app?", 0, []),
  block("updates.before.block", "Before you install", "See the plan", 0, []),
  block("updates.reports.block", "Reports", "Send crash and update reports to KeepOak", 0, []),
  block("updates.editors.block", "In your editors and notes", "VS Code", 1, []),
  { id: "updates.achievements.popup", page: "updates", card: "Achievements", label: "Achievements", level: 0, control: "toggle",
    help: "A pop-up when you unlock one. Off out of the box; they still unlock quietly and are listed under Settings › Achievements.",
    source: { kind: "coming", need: "engine: a record of achievements", reason: "Achievements comes in a later update." } },
  block("updates.achievements.badges", "Achievements", "Bronze", 0, []),
  block("updates.shortcuts.buttons", "Shortcuts, guide & apps", "Keyboard shortcuts", 0, []),
  block("updates.about.block", "About", "Open-source licences", 0, []),
  block("updates.privacy.block", "Privacy", "Privacy notice", 0, []),
  block("updates.remove.block", "Remove Branch", "Keep my conversations and settings", 0, []),
];
