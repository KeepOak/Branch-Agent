// Settings › Appearance: the rows of the R1 Appearance page, ported from the Classic Appearance page
// (places/settings/set1/appearance*.tsx) on the same keys of the person's look (appearance-store), so a choice made on
// either page shows on the other. Titles, sub-lines, defaults and options come from Classic's own row table
// (appearance-rows), and back to the default removes the choice, as Classic does. A Classic control with no key a row
// can save to (the theme gallery, light or dark, the pet history, the desktop app's switches) is a Coming row with the
// call it waits for (#952).
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

const DESKTOP_NEED = "desktop: a bridge control for this (Classic greys it: needs the Branch desktop app)";
const CHAR = "Characters";
const SHOWN = "What’s shown";

export const APPEARANCE_ROWS: Row[] = [
  // Theme
  coming("appearance.theme.mode", "Theme", "Light or dark", "window: a row source for the window's light/dark choice (theme/theme.ts setThemeChoice, then themes.set {mode})",
    "Light, dark or match this computer: the button in the top bar changes it until this row can.", { control: "segmented", options: [{ v: "light", label: "Light" }, { v: "dark", label: "Dark" }, { v: "system", label: "Match this computer" }] }),
  coming("appearance.theme.pick", "Theme", "Theme", "window: the theme gallery as a row (themes.list, themes.set)", "Browsing and picking a theme from here comes in a later update."),
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
  { id: "appearance.background.cover", page: "appearance", card: "Background", label: "How much the theme covers it", help: "More keeps text calmer; less shows more of the background.", level: 0, control: "number", unit: "%",
    source: { kind: "look", key: "scrim" }, codec: orDefault(35) },
  { id: "appearance.background.see-through", page: "appearance", card: "Background", label: "See-through panels", help: "Panels blur what’s behind them.", level: 0, control: "number", unit: "%",
    source: { kind: "look", key: "see" }, codec: orDefault(25) },
  coming("appearance.background.preview", "Background", "Preview", "window: a hold-to-preview control in the R1 row renderer", "Holding to see the background on its own comes in a later update."),

  // Reading
  fromClassic("appearance.reading.size", "Reading", "size"),
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
  fromClassic("appearance.pet.roam", "The pet", "roam"),
  fromClassic("appearance.pet.sounds", "The pet", "petSounds"),
  coming("appearance.pet.had", "The pet", "Pets you’ve had", "window: a read-only row kind, and the pet row adding to the look's petsHad and petFirst", "The pets you’ve had show on the Classic page until this row can count them."),

  // Characters: Classic's Agents section and the Advanced Characters section.
  { id: "appearance.characters.shown", page: "appearance", card: CHAR, label: "Show the agent beside the conversation", help: "The Trunk’s character shows what it is doing.", level: 0, control: "toggle",
    source: { kind: "look", key: "agentShown" }, fallback: true },
  fromClassic("appearance.characters.size", CHAR, "agentSize"),
  coming("appearance.characters.each-trunk", CHAR, "Each Trunk’s model and stage", "window: one row per Trunk (agents.update model, look \"stage:<id>\")", "Each Trunk’s model and stage background show on the Classic page for now.", { level: 1 }),
  fromClassic("appearance.characters.act", CHAR, "ch.act"),
  fromClassic("appearance.characters.move", CHAR, "ch.move"),
  fromClassic("appearance.characters.touch", CHAR, "ch.touch"),
  fromClassic("appearance.characters.captions", CHAR, "ch.cap"),

  // What's shown
  ...["show.usage", "show.gateway", "show.gfx", "show.projects", "show.live", "show.statusbar", "still", "scenery"].map((key) =>
    fromClassic(`appearance.shown.${key.replace(/^show\./, "")}`, SHOWN, key)),

  // The list
  coming("appearance.list.threads", "The list", "Threads show as", "window: a row source for the topic layout (places topic settings, setDefaultTopicLayout)", "How a contact’s threads show is set from the contact’s ⋯ › View for now."),
  { id: "appearance.list.ask-delete", page: "appearance", card: "The list", label: "Ask before deleting a conversation", help: "Removing a kept working copy always asks.", level: 1, control: "toggle",
    source: { kind: "look", key: "askDelete" }, fallback: true },
  fromClassic("appearance.list.headlines", "The list", "headlines"),
  coming("appearance.list.small-model", "The list", "Small model used", "window: a read-only row kind showing agents.defaults.utilityModel with a link to Models", "The small model is chosen in Models › Models for smaller jobs.", { level: 2 }),

  // Window
  fromClassic("appearance.window.tabs", "Window", "tabs"),
  coming("appearance.window.layout", "Window", "Customize layout", "window: a layout editor", "Drag the edge of the list or the side panel to change its width.", { help: "Drag the list and the side panel to the widths you like." }),
  coming("appearance.window.kiosk", "Window", rowOf("kiosk").title, DESKTOP_NEED, rowOf("kiosk").off ?? "", { help: rowOf("kiosk").sub, level: 1, control: "toggle" }),
  coming("appearance.window.frame", "Window", "Window frame", DESKTOP_NEED, "Branch’s own title bar or the system one needs the Branch desktop app.", { level: 2 }),

  // Tray
  coming("appearance.tray.menu", "Tray", "Tray menu", DESKTOP_NEED, "What Branch puts in the tray needs the Branch desktop app.", { help: "What Branch puts in the tray: its icon and menu." }),

  // Language
  coming("appearance.language.pick", "Language", "Language", "engine: a language setting and translated words (English only today)", "Other languages come with the Branch app.", { help: "Dates and numbers follow it too.", control: "select",
    options: [{ v: "en", label: "English" }] }),

  // Make it yours: Classic's Make your own theme.
  coming("appearance.yours.make-theme", "Make it yours", "Make your own theme", "window: the theme editor opened from a row (themes.import)", "Making your own theme from here comes in a later update."),
];
