// Settings › Appearance: the rows of the R1 Appearance page, ported from the Classic Appearance page
// (places/settings/set1/appearance*.tsx) on the same keys of the person's look (appearance-store), so a choice made on
// either page shows on the other. Titles, sub-lines, defaults and options come from Classic's own row table
// (appearance-rows), and back to the default removes the choice, as Classic does. A Classic control with no key a row
// can save to (light or dark, the theme gallery and editor, any accent colour, the background preview, the pet history,
// each Trunk's model and stage, how threads show, the small model) is a "slot" row: the page draws it with Classic's own
// logic (appearance-live.tsx, plugged.ts), so nothing working is left behind (#976). What Classic itself greys (the
// desktop app's switches, other languages) stays a Coming row with the call it waits for (#952).
import { ACCENTS } from "../../../places/settings/set1/appearance-editor";
import { DEFAULT_PET, PETS } from "../../../places/settings/set1/appearance-pet";
import { rowOf, type RowSpec } from "../../../places/settings/set1/appearance-rows";
import { FONTS, SCENES } from "../../../places/settings/set1/appearance-sections";
import type { Level } from "../nav";
import type { Codec, Control, Row, RowOption } from "../rows";

/** Shows the stored choice or the default; saving the default removes the choice (Classic's SpecRow). */
export const orDefault = (def: unknown): Codec => ({ read: (v) => (v === undefined || v === null ? def : v), write: (x) => (x === def ? null : x) });
/** A font or accent list whose first choice is "the theme's own": stored as no choice at all. */
const themeOwn = (own: string): Codec => ({ read: (v) => (typeof v === "string" && v ? v : own), write: (x) => (x === own ? null : x) });

const CONTROL: Record<RowSpec["kind"], Control> = { sw: "toggle", seg: "segmented", pick: "select" };
/** Classic options that can't be chosen yet (greyed in Classic) stay out of the list; a row says what is missing. */
const optionsOf = (spec: RowSpec): RowOption[] | undefined => spec.opts?.filter((o) => !o.off).map((o) => ({ v: o.id, label: o.label }));

/** One row from Classic's table, on the same look key. */
function fromClassic(id: string, card: string, key: string, extra: Partial<Row> = {}): Row {
  const spec = rowOf(key);
  const options = optionsOf(spec);
  // A segmented control holds 2 to 4 choices; Classic's longer segment rows become a list.
  const control = spec.kind === "seg" && (options?.length ?? 0) > 4 ? "select" : CONTROL[spec.kind];
  return { id, page: "appearance", card, label: spec.title, help: spec.sub, level: (spec.lv ?? 0) as Level, control, ...(options ? { options } : {}),
    source: { kind: "look", key }, codec: orDefault(spec.def), ...extra };
}
const coming = (id: string, card: string, label: string, need: string, reason: string, extra: Partial<Row> = {}): Row =>
  ({ id, page: "appearance", card, label, level: 0, control: "custom", source: { kind: "coming", need, reason }, ...extra });
/** A row the page draws itself (appearance-live.tsx), making these calls. */
const slot = (id: string, card: string, label: string, calls: string[], extra: Partial<Row> = {}): Row =>
  ({ id, page: "appearance", card, label, level: 0, control: "custom", source: { kind: "slot", calls, reason: `${label} comes with the R1 Appearance page.` }, ...extra });

const DESKTOP_NEED = "desktop: a bridge control for this (Classic greys it: needs the Branch desktop app)";
const CHAR = "Characters";
const SHOWN = "What’s shown";
const YOURS = "Make it yours";
/** A What's shown row saved straight to the engine's config (preview "Seeing more"), Advanced unless said. */
const config = (id: string, label: string, help: string, path: string, fallback: unknown, extra: Partial<Row> = {}): Row =>
  ({ id, page: "appearance", card: SHOWN, label, help, level: 1, ownerLevel: true, control: "toggle", source: { kind: "config", path }, fallback, ...extra });

export const APPEARANCE_ROWS: Row[] = [
  // Theme
  slot("appearance.theme.mode", "Theme", "Light or dark", ["themes.set"], { control: "segmented", options: [{ v: "light", label: "Light" }, { v: "dark", label: "Dark" }, { v: "system", label: "Auto" }] }),
  slot("appearance.theme.pick", "Theme", "Theme", ["themes.list", "themes.set", "themes.import", "users.prefs.set"], { help: "Browse every theme, or make your own." }),
  // Accent and Pet stay rows on their look keys; the page draws them with Classic's colour well and pet history.
  { id: "appearance.theme.accent", page: "appearance", card: "Theme", label: "Accent colour", help: "Only for what wants you: the working ring, the waiting dot, the yes button.", level: 0, control: "select",
    options: [{ v: "theme", label: "The theme’s own" }, ...ACCENTS.map((a) => ({ v: a, label: a.toUpperCase() }))], source: { kind: "look", key: "accent" }, codec: themeOwn("theme") },
  fromClassic("appearance.theme.contrast", "Theme", "contrast"),
  fromClassic("appearance.theme.transparency", "Theme", "reduceTransparency"),

  // Background
  fromClassic("appearance.background.behind", "Background", "bg"),
  coming("appearance.background.own", "Background", "Your own background", "engine: a place to keep a file of your own as the background", "Branch can’t keep a file of your own as a background yet."),
  fromClassic("appearance.background.season", "Background", "season", { help: "With The grove behind the glass. Fireflies in summer, petals in spring, leaves in autumn, snow in winter." }),
  { id: "appearance.background.scene", page: "appearance", card: "Background", label: "Painted scenes", help: "With Painted grove behind the glass.", level: 0, control: "select",
    options: SCENES.map((s) => ({ v: s.id, label: s.name })), source: { kind: "look", key: "scene" }, codec: orDefault("auto") },
  { id: "appearance.background.cover", page: "appearance", card: "Background", label: "How much the theme covers it", help: "More keeps text calmer; less shows more of the background.", level: 0, control: "slider", unit: "%", range: { min: 0, max: 90, step: 5 },
    source: { kind: "look", key: "scrim" }, codec: orDefault(35) },
  { id: "appearance.background.see-through", page: "appearance", card: "Background", label: "See-through panels", help: "Panels blur what’s behind them.", level: 0, control: "slider", unit: "%", range: { min: 0, max: 60, step: 5 },
    source: { kind: "look", key: "see" }, codec: orDefault(25) },
  slot("appearance.background.preview", "Background", "Preview", [], { help: "Hold it to see the background on its own." }),

  // Reading
  { id: "appearance.reading.width", page: "appearance", card: "Reading", label: "Conversation width", help: "Wide uses more of a big screen.", level: 0, control: "segmented",
    options: [{ v: "comfortable", label: "Comfortable" }, { v: "wide", label: "Wide" }, { v: "full", label: "Full" }], source: { kind: "look", key: "width" }, fallback: "comfortable" },
  fromClassic("appearance.reading.size", "Reading", "size", { help: "Changes every screen. This device only." }),
  fromClassic("appearance.reading.messages", "Reading", "msgLook"),
  fromClassic("appearance.reading.direction", "Reading", "dir"),
  fromClassic("appearance.reading.math", "Reading", "math"),
  fromClassic("appearance.reading.scroll", "Reading", "scroll"),
  fromClassic("appearance.reading.code", "Reading", "codeCol"),
  coming("appearance.reading.editor-theme", "Reading", rowOf("edTheme").title, "editor: the VS Code and JetBrains panels passing their theme to the window", rowOf("edTheme").off ?? "", { help: rowOf("edTheme").sub, control: "toggle" }),
  { id: "appearance.reading.font-ui", page: "appearance", card: "Reading", label: "Interface font", level: 1, control: "select", options: FONTS.map((f) => ({ v: f.id, label: f.label })),
    source: { kind: "look", key: "fontUi" }, codec: themeOwn("theme") },
  { id: "appearance.reading.font-chat", page: "appearance", card: "Reading", label: "Conversation font", help: "The theme’s own is what the theme was drawn with.", level: 1, control: "select",
    options: FONTS.map((f) => ({ v: f.id, label: f.label })), source: { kind: "look", key: "fontChat" }, codec: themeOwn("theme") },

  // The pet
  { id: "appearance.pet.pick", page: "appearance", card: "The pet", label: "Pet", level: 0, control: "select", options: PETS.map((p) => ({ v: p.id, label: p.name })),
    source: { kind: "look", key: "pet" }, codec: orDefault(DEFAULT_PET) },
  { id: "appearance.pet.name", page: "appearance", card: "The pet", label: "Name", help: "Shown on the pet’s tips and menu.", level: 0, control: "text", source: { kind: "look", key: "petName" },
    codec: { read: (v) => (typeof v === "string" && v ? v : "Hazel"), write: (x) => { const t = typeof x === "string" ? x.trim().slice(0, 40) : ""; return t && t !== "Hazel" ? t : null; } } },
  fromClassic("appearance.pet.sounds", "The pet", "petSounds"),
  slot("appearance.pet.had", "The pet", "Pets you’ve had", [], { control: "text" }),

  // Characters: Classic's Agents section and the Advanced Characters section.
  { id: "appearance.characters.shown", page: "appearance", card: CHAR, label: "Show the agent beside the conversation", help: "The Trunk’s character shows what it is doing.", level: 0, control: "toggle",
    source: { kind: "look", key: "agentShown" }, fallback: false },
  fromClassic("appearance.characters.size", CHAR, "agentSize"),
  { id: "appearance.characters.cheer", page: "appearance", card: CHAR, label: "Celebrate when a task finishes", help: "A small card with the Trunk’s face shows when a task is done.", level: 0, control: "toggle",
    source: { kind: "look", key: "cheer" }, fallback: false },
  slot("appearance.characters.each-trunk", CHAR, "Each Trunk’s model and stage", ["agents.list", "models.list", "agents.update", "users.prefs.set"], { level: 1 }),
  fromClassic("appearance.characters.act", CHAR, "ch.act"),
  fromClassic("appearance.characters.move", CHAR, "ch.move"),
  fromClassic("appearance.characters.touch", CHAR, "ch.touch"),
  fromClassic("appearance.characters.captions", CHAR, "ch.cap"),

  // What's shown
  ...["show.usage", "show.gateway", "show.gfx", "show.projects", "show.live", "show.statusbar", "still", "scenery"].map((key) =>
    fromClassic(`appearance.shown.${key.replace(/^show\./, "")}`, SHOWN, key)),
  // The preview's What's shown continues with the status symbols and "Seeing more" (preview 32594-32601).
  slot("appearance.shown.symbols", SHOWN, "Status symbols", [], { bare: true }),
  coming("appearance.shown.notes", SHOWN, "Keep progress notes", "engine: a setting that keeps a Trunk's progress notes", "Keeping progress notes comes in a later update.",
    { help: "The short notes a Trunk writes between steps stay after it finishes. The ⋯ › View row overrides it for one window.", level: 1, control: "toggle" }),
  config("appearance.shown.activity-log", "Keep an activity log", "Every step, kept for 30 days on this computer.", "logging.audit.enabled", true),
  config("appearance.shown.who-ran", "Record who ran each task", "Keeps who started each run, from where, and what allowed it, for “What happened in this run”. Off until you choose: it records more about each person. Takes effect after the gateway restarts; records already kept stay readable until they are 30 days old.", "logging.audit.executionIdentity", false),
  config("appearance.shown.messages", "Record messages", "Who sent what to whom and when, never the text. Takes effect after the gateway restarts.", "logging.audit.messages", "off",
    { control: "segmented", options: [{ v: "off", label: "Off" }, { v: "direct", label: "Direct messages" }, { v: "all", label: "All" }] }),
  coming("appearance.shown.crash", SHOWN, "Send crash reports", "engine: a crash reporter", "Sending crash reports comes in a later update.",
    { help: "Only the error, never your conversations. Off until you choose: it sends the error outside this computer.", level: 1, control: "toggle" }),
  config("appearance.shown.counts", "Share anonymous feature counts", "Counts only, never messages or names: once a day, with the update check, which chat apps and model services are on, how many plugins, and how many conversations were started. It stays off whenever DO_NOT_TRACK=1 is set on this computer. Off until you choose: it sends counts outside this computer.", "telemetry.enabled", false),
  slot("appearance.shown.report", SHOWN, "Report for a bug", [], { level: 1, help: "A zip of status, health, recent log lines, the shape of your settings and the stability record. Passwords, keys and message text are left out. It stays on this computer until you share it. Not the same as “Send crash reports”, which sends only errors." }),
  config("appearance.shown.stability", "Keep a stability record", "A small record of stalls and crashes, without message text, kept on this computer.", "diagnostics.enabled", true, { level: 2 }),

  // The list
  slot("appearance.list.threads", "The list", "Threads show as", [], { help: "How a contact’s threads show beside its chat. A contact’s ⋯ › View can differ.", control: "segmented",
    options: [{ v: "tabs", label: "Tabs" }, { v: "free", label: "Freedom Mode" }] }),
  { id: "appearance.list.ask-delete", page: "appearance", card: "The list", label: "Ask before deleting a conversation", help: "Removing a kept working copy always asks.", level: 1, control: "toggle",
    source: { kind: "look", key: "askDelete" }, fallback: true },
  fromClassic("appearance.list.headlines", "The list", "headlines"),
  slot("appearance.list.small-model", "The list", "Small model used", ["config.get"], { level: 2 }),

  // Window
  fromClassic("appearance.window.tabs", "Window", "tabs"),
  coming("appearance.window.layout", "Window", "Customize layout", "window: a layout editor", "Drag the edge of the list or the side panel to change its width.", { help: "Drag the list and the side panel to the widths you like." }),
  coming("appearance.window.kiosk", "Window", rowOf("kiosk").title, DESKTOP_NEED, rowOf("kiosk").off ?? "", { help: rowOf("kiosk").sub, level: 1, control: "toggle" }),
  coming("appearance.window.frame", "Window", "Window frame", DESKTOP_NEED, "Choosing the window frame comes in a later update.", { level: 2, help: "Branch’s own title bar or the system one." }),

  // Tray
  coming("appearance.tray.menu", "Tray", "Tray menu", DESKTOP_NEED, "What Branch puts in the tray needs the Branch desktop app.", { help: "What Branch puts in the tray: its icon and menu." }),

  // Language
  coming("appearance.language.pick", "Language", "Language", "engine: a language setting and translated words (English only today)", "Other languages come with the Branch app.", { help: "Dates and numbers follow it too.", control: "select",
    options: [{ v: "en", label: "English" }] }),

  // Make it yours (preview: Share your look, then Pictures around Branch). Making a theme stays in the Theme card.
  slot("appearance.yours.pet", YOURS, "Your pet", [], { help: "A pet seed carries its sprite and every frame (idle, walk, cheer, notice, pat)." }),
  slot("appearance.yours.theme", YOURS, "This theme and background", []),
  slot("appearance.yours.paste", YOURS, "Got a seed?", []),
  slot("appearance.yours.picture", YOURS, "Your picture", [], { help: "On your card, the avatar and Who is using Branch." }),
  slot("appearance.yours.overview", YOURS, "Overview background", [], { help: "The picture behind the composer on Overview." }),
  slot("appearance.yours.chat", YOURS, "Chat background", [], { help: "Behind the glass, in every conversation." }),
  slot("appearance.yours.trunks", YOURS, "Trunk, group and topic pictures", [], { help: "Or ••• › Change picture in any conversation." }),
  slot("appearance.yours.own-pet", YOURS, "A pet of your own", [], { help: "Your pets walk on the rim of the message box." }),
];
