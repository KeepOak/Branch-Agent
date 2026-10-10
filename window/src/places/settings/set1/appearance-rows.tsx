// Settings › Appearance: every plain row (switches, segments, lists) as one table: the preview's titles, sub-lines,
// defaults (51-set1p OWN_DEF_PE18 and the captured states), levels and where each choice is kept. The page draws the
// rows from it and the settings search lists them from it, so the two can't drift.
// TODO(engine-lane): TODO(desktop-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import type { Keep, Lv, Opt, RowEntry } from "../kit";

export type Kind = "sw" | "seg" | "pick";
export type RowSpec = { sec: string; group?: string; title: string; key: string; kind: Kind; def: string | boolean; sub?: string; help?: string; opts?: Opt[]; lv?: Lv; keep?: Keep; off?: string };

/** Only on parts the window draws with a right-click Hide this (shell/shown.ts HIDEABLE). */
const SHOWN = "Right-click it anywhere to hide it too.";
/** Things only the Branch desktop app or the computer itself can do. */
export const DESKTOP = "Needs the Branch desktop app.";
const o = (pairs: [string, string][], off: Record<string, string> = {}): Opt[] => pairs.map(([id, label]) => ({ id, label, ...(off[id] ? { off: off[id] } : {}) }));

export const FACE_KINDS = ["Videos", "Live2D", "3D (VRM)", "MikuMikuDance", "Spine", "Sprites", "Godot"];
/** Faces are drawn as videos and stills, with no separate eyes or mouth to move. */
const FACE_PARTS = "Faces are drawn as videos, with no eyes or mouth of their own to move.";
export const FACE_OFF = "Branch draws faces as videos for now; other kinds need their own renderer in the window.";

/** The page has two "Reading" sections; the second one's rows are kept under this name. */
export const READING_MORE = "Reading ";

export const ROWS: RowSpec[] = [
  { sec: "Theme", title: "More contrast", key: "contrast", kind: "sw", def: false, sub: "Stronger lines and text, from each theme’s own high-contrast colours.", keep: "everywhere" },
  { sec: "Agents", title: "Size", key: "agentSize", kind: "seg", def: "m", sub: "Small keeps it out of the way.", opts: o([["s", "Small"], ["m", "Medium"], ["l", "Large"]]) },
  { sec: "Background", title: "Behind the glass", key: "bg", kind: "seg", def: "none", keep: "everywhere", sub: "The grove and the oak wear the theme’s colours. A scrim in the theme’s own colour keeps text readable.",
    opts: o([["none", "None"], ["painted", "Painted grove"], ["grove", "The grove"], ["oak3d", "The oak in 3D"], ["rings", "Growth rings"], ["own", "Your own"]], { own: "Branch can’t keep a file of your own as a background yet." }) },
  { sec: "Background", title: "Season", key: "season", kind: "seg", def: "auto", keep: "everywhere", sub: "Fireflies in summer, petals in spring, leaves in autumn, snow in winter.", opts: o([["auto", "By the date"], ["spring", "Spring"], ["summer", "Summer"], ["autumn", "Autumn"], ["winter", "Winter"]]) },
  { sec: "Reading", title: "Text size", key: "size", kind: "seg", def: "Regular", keep: "device", sub: "Changes every screen.", opts: o([["small", "Small"], ["Regular", "Regular"], ["large", "Large"], ["larger", "Larger"], ["largest", "Largest"]]) },
  { sec: "The pet", title: "Let it roam", key: "roam", kind: "sw", def: false, keep: "everywhere", sub: "The pet walks along the chat, and the Trunk card steps aside. Off keeps the card as the one pet." },
  { sec: "The pet", title: "Pet sounds", key: "petSounds", kind: "sw", def: false, keep: "everywhere", sub: "A tiny sound when you pat it.", help: "Off until you turn it on." },
  { sec: "What’s shown", title: "The usage ring", key: "show.usage", kind: "sw", def: true, keep: "everywhere", sub: SHOWN },
  { sec: "What’s shown", title: "The gateway in the status bar", key: "show.gateway", kind: "sw", def: true, keep: "everywhere", sub: SHOWN },
  { sec: "What’s shown", title: "Graphics and memory", key: "show.gfx", kind: "sw", def: false, keep: "everywhere", sub: "Shows this computer’s graphics card and memory.", help: "Off until you choose: it keeps checking this computer’s graphics card and memory." },
  { sec: "What’s shown", title: "Projects in the list", key: "show.projects", kind: "sw", def: true, keep: "everywhere", sub: SHOWN },
  { sec: "What’s shown", title: "What a working Trunk is doing, in the list", key: "show.live", kind: "sw", def: true, keep: "everywhere", sub: "The row’s preview shows its latest step while it works." },
  { sec: "What’s shown", title: "The whole status bar", key: "show.statusbar", kind: "sw", def: true, keep: "everywhere", sub: "Lockdown’s banner and Stop while a task runs can never be hidden." },
  { sec: "What’s shown", title: "Keep things still", key: "still", kind: "sw", def: false, keep: "everywhere", sub: "Stops the pet moving, the working ring and the logo’s float.", help: "Off until you choose: it freezes every face, so none plays its action animations." },
  { sec: "What’s shown", title: "Scenery behind the list", key: "scenery", kind: "sw", def: false, keep: "everywhere", sub: "A small pixel oak at the foot of the list." },
  { sec: READING_MORE, title: "Messages", key: "msgLook", kind: "seg", def: "bubbles", sub: "Full width reads like a document.", opts: o([["bubbles", "Chat bubbles"], ["full", "Full width"]]) },
  { sec: READING_MORE, title: "Text direction", key: "dir", kind: "seg", def: "auto", sub: "Arabic, Hebrew and Persian read right to left; the conversation follows.", opts: o([["auto", "Follow the language"], ["rtl", "Right to left"], ["ltr", "Left to right"]]) },
  { sec: READING_MORE, title: "Show maths as formulas", key: "math", kind: "sw", def: true, sub: "LaTeX in replies shows as typeset maths." },
  { sec: READING_MORE, title: "Scroll bars", key: "scroll", kind: "seg", def: "scrolling", opts: o([["scrolling", "While scrolling"], ["always", "Always"]]) },
  { sec: READING_MORE, title: "Code colours", key: "codeCol", kind: "pick", def: "theme", sub: "For code blocks and the terminal view.", opts: o([["theme", "Follow the theme"], ["github", "GitHub"], ["monokai", "Monokai"], ["solarized", "Solarized"], ["tm", "Your .tmTheme file"]], { tm: "Branch can’t read a .tmTheme file yet." }) },
  { sec: READING_MORE, title: "Inside an editor, follow its theme", key: "edTheme", kind: "sw", def: true, off: "Only when Branch runs inside VS Code or JetBrains; this window runs on its own.", sub: "In VS Code or JetBrains, the Branch panel wears the editor’s colours." },
  { sec: "Window", title: "Conversations as tabs", key: "tabs", kind: "sw", def: false, sub: "A tab row above the conversation for the ones you opened; close the ones you’re done with." },
  { sec: "Window", title: "One full-screen window", key: "kiosk", kind: "sw", def: false, lv: 1, off: DESKTOP, sub: "No title bar; Trunks fill the screen.", help: "For a computer that only runs Branch. Off until you choose: it hides the rest of the computer." },
  { sec: "Characters", group: "The Trunk beside the conversation", title: "Faces show feelings", key: "ch.feel", kind: "sw", def: true, lv: 1, off: "Needs the engine to send a Trunk’s feelings to the window; it sends none today.", sub: "The Trunk’s model may set a feeling for a moment, then it goes back." },
  { sec: "Characters", group: "The Trunk beside the conversation", title: "Acts out what it is doing", key: "ch.act", kind: "sw", def: true, lv: 1, sub: "Thinking, searching, reading, waiting for you, celebrating." },
  { sec: "Characters", group: "The Trunk beside the conversation", title: "Moves while it speaks", key: "ch.move", kind: "sw", def: true, lv: 1, sub: "Only while it talks; still at rest." },
  { sec: "Characters", group: "The Trunk beside the conversation", title: "Mouth follows the voice", key: "ch.mouth", kind: "sw", def: true, lv: 1, off: FACE_PARTS, sub: "From the Trunk’s own voice." },
  { sec: "Characters", group: "The Trunk beside the conversation", title: "Eyes follow the pointer", key: "ch.eyes", kind: "sw", def: false, lv: 1, off: FACE_PARTS, sub: "Only while you move it; still at rest." },
  { sec: "Characters", group: "The Trunk beside the conversation", title: "Bobs to music", key: "ch.music", kind: "sw", def: false, lv: 1, off: "Needs the Branch desktop app to hear what plays on this computer.", sub: "While music plays on this computer. Off until you choose: it listens to what plays." },
  { sec: "Characters", group: "The Trunk beside the conversation", title: "Light from the screen", key: "ch.light", kind: "sw", def: false, lv: 1, off: "Needs the Branch desktop app to read the screen.", sub: "Picks up the colours behind it. Off until you choose: it reads the screen." },
  { sec: "Characters", group: "The Trunk beside the conversation", title: "Reacts when you touch it", key: "ch.touch", kind: "sw", def: true, lv: 1, sub: "Head, hands or body; each plays once." },
  { sec: "Characters", group: "The Trunk beside the conversation", title: "Captions under it", key: "ch.cap", kind: "sw", def: true, lv: 1, sub: "What it says, as it says it." },
  { sec: "Characters", group: "The Trunk beside the conversation", title: "Float it beside the chat", key: "ch.float", kind: "sw", def: false, lv: 1, off: "Needs the Branch desktop app to float a window over others.", sub: "An always-on-top character; chat docks beside it. Off until you choose: it sits over other windows." },
  { sec: "Characters", group: "The Trunk beside the conversation", title: "Copy my moves from the camera", key: "ch.cam", kind: "sw", def: false, lv: 1, off: "Needs the Branch desktop app to use the camera.", sub: "Your pose drives a 3D character. Off until you choose: it uses the camera." },
  { sec: "Characters", group: "The Trunk beside the conversation", title: "Leaves follow the pointer", key: "ch.leaves", kind: "sw", def: false, lv: 1, off: "The window has no pointer trail to draw the leaves with.", sub: "A few leaves trail the pointer while it moves." },
  { sec: "Characters", group: "The Trunk beside the conversation", title: "A creature that moves with real work", key: "ch.creature", kind: "sw", def: false, lv: 1, off: "The window has no creature to move; faces act out the work instead.", sub: "Its motion comes from what Trunks actually do: steps, files, errors. Still when nothing happens." },
  { sec: "Characters", group: "The Trunk beside the conversation", title: "Drive a VTube Studio avatar", key: "ch.vts", kind: "sw", def: false, lv: 1, off: "The engine has no VTube Studio connection yet.", sub: "Your Live2D streaming avatar acts out replies through VTube Studio’s own connection." },
  { sec: "The list", group: "Status bar and list", title: "Headlines for working conversations", key: "headlines", kind: "sw", def: true, lv: 1, keep: "everywhere", sub: "A one-line headline and a health check under each working conversation. Headlines come from the Trunk’s own steps; the health check uses the small model." },
];

export const rowsOf = (sec: string) => ROWS.filter((r) => r.sec === sec);
export const rowOf = (key: string): RowSpec => ROWS.find((r) => r.key === key) as RowSpec;
export const DEFAULTS: Record<string, unknown> = Object.fromEntries(ROWS.map((r) => [r.key, r.def]));

/** Rows the page draws by hand (galleries, buttons), for the search. */
const OTHER: [string, string, Lv][] = [
  ["Light or dark", "Match this computer", 0], ["Theme", "Theme", 0], ["Theme", "Accent colour", 0], ["Agents", "Show the agent beside the conversation", 0],
  ["Background", "Painted scenes", 0], ["Background", "How much the theme covers it", 0], ["Background", "See-through panels", 0], ["Background", "Preview", 0],
  ["Reading", "Interface font", 1], ["Reading", "Conversation font", 1], ["The pet", "Pet", 0], ["The pet", "Name", 0], ["The pet", "Pets you’ve had", 0],
  ["Language", "Language", 0], ["Tray", "Tray menu", 0], ["Window", "Customize layout", 0], ["Characters", "How faces are drawn", 1],
  ["Characters", "Bring in a character", 1], ["Characters", "Pose by hand", 1], ["Characters", "Describe a pet", 1], ["Pictures around Branch", "Pictures around Branch", 1],
  ["Window, technical", "Window frame", 2], ["The list", "Ask before deleting a conversation", 1],
];

export const APPEARANCE_ROWS: RowEntry[] = [
  ...OTHER.map(([sec, title, lv]) => ({ page: "appearance", title, sec, group: sec.replace(/, (more|technical|in depth)$/, ""), lv })),
  // Season shows only with "The grove" behind the glass, so search can't land on it.
  ...ROWS.filter((r) => r.key !== "season").map((r) => ({ page: "appearance", title: r.title, sec: r.sec.trim(), group: r.group ?? r.sec.trim(), lv: r.lv ?? 0 })),
];
