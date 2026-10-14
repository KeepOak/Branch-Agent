// Settings › Automations: the rows of the R1 page, in the approved preview's order and words (preview.html PG autos,
// item 36: Automations and Steps and nudges, both from Classic Advanced, so the page shows from Advanced up and says so at
// Regular). Keys follow Classic Advanced (places/settings/set2/advanced.tsx, sections Automations, Automations more and
// Automations steps and nudges) and Classic Developer's Automations, technical (set2/developer.tsx), whose rows are wired
// and tested. A row the engine has no key for is Coming. Rows whose control does more than one key are drawn by the page
// (autos-live.tsx), named here as "slot" rows.
import type { Row, RowOption } from "../rows";
import { NO_KEY } from "./customize";

const AUTOS = "Automations";
const STEPS = "Steps and nudges";
const FA = "cron.failureAlert";
const MIN = 60_000;

const no = (what: string, reason = NO_KEY) => ({ kind: "coming" as const, need: `config: ${what}`, reason });
const opts = (...labels: string[]): RowOption[] => labels.map((l) => ({ v: l, label: l }));
const slot = (calls: string[], reason: string) => ({ kind: "slot" as const, calls, reason });

type Base = Pick<Row, "id" | "card" | "level" | "control" | "source"> & Partial<Row>;
const row = (r: Base): Row => ({ page: "autos", ...r });

export const AUTOS_ROWS: Row[] = [
  row({ id: "autos.autos.github", card: AUTOS, label: "Run on GitHub Actions while this computer is off", help: "Schedules and their skills run on free GitHub runners; results and memory come back as commits. Off until you choose: your skills run on GitHub’s computers.", level: 1, control: "toggle",
    source: no("running automations on GitHub Actions") }),
  row({ id: "autos.autos.changed-only", card: AUTOS, label: "Report only what changed", help: "Checks compare with last time and stay quiet otherwise.", level: 1, control: "toggle", source: no("a report-only-changes switch") }),
  row({ id: "autos.autos.retries", card: AUTOS, label: "Checks and retries in procedures", help: "A step can check its own result, retry, and clean up.", level: 1, control: "toggle", source: no("checks and retries in procedures") }),
  row({ id: "autos.autos.self-start", card: AUTOS, label: "Procedures that start themselves", help: "On a clock or after a task. Only procedures you set a time for.", level: 1, control: "toggle", source: no("procedures that start themselves") }),
  row({ id: "autos.autos.usb", card: AUTOS, label: "Start when a USB device is plugged in", help: "Only for triggers you make.", level: 1, control: "toggle", source: no("a USB trigger") }),
  row({ id: "autos.autos.webhooks", card: AUTOS, label: "Reach webhooks from outside", help: "Off until you choose: it opens a door from the internet.", level: 1, control: "segmented", options: opts("Off", "cloudflared", "ngrok", "Tailscale"), fallback: "Off",
    source: no("a way to reach webhooks from outside") }),
  row({ id: "autos.autos.payload", card: AUTOS, label: "Use what the trigger sent", help: "{{payload}} and {{field.path}} in the prompt.", level: 1, control: "toggle", source: no("trigger payloads in prompts") }),
  row({ id: "autos.autos.triggers", card: AUTOS, label: "Checks before a run and event triggers", help: "Lets a trigger look first and start a Trunk only when there is news. Off stops every “Check first”, script and stream trigger without deleting them.", level: 1, control: "toggle", fallback: true,
    source: { kind: "config", path: "cron.triggers.enabled" } }),
  row({ id: "autos.autos.alert", card: AUTOS, label: "Tell me when an automation keeps failing", help: "After 2 failures in a row, at most once an hour, where the automation reports. On because it only tells you where that automation already sends; each automation can choose its own (When it fails…).", level: 1, control: "toggle", fallback: true,
    source: { kind: "config", path: `${FA}.enabled` } }),
  row({ id: "autos.autos.alert-after", card: AUTOS, label: "After failures in a row", level: 1, control: "number", unit: "failures", fallback: 2, source: { kind: "config", path: `${FA}.after` } }),
  row({ id: "autos.autos.alert-every", card: AUTOS, label: "At most every", level: 1, control: "select", options: [[15, "15 minutes"], [60, "1 hour"], [360, "6 hours"], [1440, "1 day"]].map(([m, label]) => ({ v: Number(m) * MIN, label: String(label) })),
    source: { kind: "config", path: `${FA}.cooldownMs` }, codec: { read: (v) => (typeof v === "number" ? v : 60 * MIN), write: (v) => Number(v) } }),
  row({ id: "autos.autos.alert-skipped", card: AUTOS, label: "Count skipped runs", level: 1, control: "toggle", fallback: false, source: { kind: "config", path: `${FA}.includeSkipped` } }),
  row({ id: "autos.autos.alert-to", card: AUTOS, label: "Send alerts to", level: 1, control: "custom", source: slot(["config.patch"], "Choosing where alerts go comes in a later update.") }),
  row({ id: "autos.autos.alert-recipient", card: AUTOS, label: "Recipient", level: 2, control: "text", source: { kind: "config", path: `${FA}.to` } }),
  row({ id: "autos.autos.alert-account", card: AUTOS, label: "Chat-app account", level: 2, control: "text", source: { kind: "config", path: `${FA}.accountId` } }),
  row({ id: "autos.autos.alert-how", card: AUTOS, label: "How", help: "Sends the alert as a message, or posts it to the web address.", level: 1, control: "segmented", options: [{ v: "announce", label: "As a message" }, { v: "webhook", label: "To a web address" }],
    fallback: "announce", source: { kind: "config", path: `${FA}.mode` } }),
  row({ id: "autos.autos.catch-up", card: AUTOS, label: "Catch up on runs missed while Branch was off", help: "Off: a missed run is skipped and the next one waits for its time. One-off runs always catch up.", level: 1, control: "toggle",
    source: { kind: "config", path: "cron.skipMissedJobs" }, codec: { read: (v) => v !== true, write: (on) => !on } }),
  row({ id: "autos.autos.keep-run", card: AUTOS, label: "Keep each run’s own conversation for", level: 1, control: "segmented",
    options: [{ v: "1h", label: "1 hour" }, { v: "24h", label: "24 hours" }, { v: "7d", label: "7 days" }, { v: "forever", label: "Forever" }],
    source: { kind: "config", path: "cron.sessionRetention" }, codec: { read: (v) => (v === false ? "forever" : typeof v === "string" && v ? v : "24h"), write: (v) => (v === "forever" ? false : v) } }),
  row({ id: "autos.autos.history", card: AUTOS, label: "Run history", level: 1, control: "custom", source: { kind: "coming", need: "engine: how long run history is kept", reason: "The engine doesn’t say how long it keeps run history." } }),
  row({ id: "autos.autos.private-hosts", card: AUTOS, label: "Private addresses allowed for web addresses", level: 2, control: "custom", source: slot(["config.patch"], "Allowing private addresses comes in a later update.") }),
  row({ id: "autos.autos.commands", card: AUTOS, label: "Chat commands", help: "Which slash commands are on and who may use them.", level: 2, control: "custom", source: slot(["config.get", "config.patch"], "Editing chat commands comes in a later update.") }),
  row({ id: "autos.autos.hooks", card: AUTOS, label: "Hooks", help: "Programs that run when something happens.", level: 2, control: "custom", source: slot(["config.get", "config.patch"], "Editing hooks comes in a later update.") }),
  row({ id: "autos.autos.bindings", card: AUTOS, label: "Which Trunk answers", help: "Rules that send a chat to a Trunk.", level: 2, control: "custom", source: slot(["config.get", "config.patch"], "Editing which Trunk answers comes in a later update.") }),
  row({ id: "autos.autos.schedules", card: AUTOS, label: "Schedules", help: "Every scheduler setting.", level: 2, control: "custom", source: slot(["config.get", "config.patch"], "Editing every scheduler setting comes in a later update.") }),
  row({ id: "autos.autos.flow-search", card: AUTOS, label: "Flow search", help: "Tries four versions of a flow on examples and keeps the best. Off until you choose: it runs four versions, four times the cost.", level: 2, control: "toggle", source: no("flow search") }),
  row({ id: "autos.autos.loop", card: AUTOS, label: "Loop a prompt", help: "/loop 10m check the build · Or /heartbeat for the check-in list.", level: 2, control: "custom", source: { kind: "coming", need: "engine: a /loop command", reason: "Looping a prompt comes in a later update." } }),

  row({ id: "autos.steps.other-apps", card: STEPS, label: "Steps for other apps", help: "Lets a procedure send email, read an inbox and change spreadsheets. Off until you choose: steps send to outside apps.", level: 1, control: "toggle", source: no("steps for other apps") }),
  row({ id: "autos.steps.nudge", card: STEPS, label: "Nudge a long task that stops early", help: "When a lead Trunk stops before its goal, it’s nudged on, or you’re asked if something really blocks it.", level: 1, control: "toggle", source: no("a nudge for long tasks") }),
];
