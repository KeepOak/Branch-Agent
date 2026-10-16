// Settings › Instructions & personality: the approved preview's seven cards (preview.html PG instructions), in order. Just
// about you and the files each Trunk reads are Classic's own blocks (instructions-you.tsx, instructions.tsx) drawn in
// their cards without a Classic heading; every other row waits for Branch and is Coming in its own words.
import type { Level } from "../nav";
import type { Control, Row, RowOption } from "../rows";

type Extra = { help?: string; level?: Level; control?: Control; options?: RowOption[] };
const coming = (id: string, card: string, label: string, need: string, extra: Extra = {}): Row =>
  ({ id, page: "instructions", card, label, level: 0, control: "custom", ...extra, source: { kind: "coming", need, reason: `${label} comes in a later update.` } });
const opts = (xs: string[]): RowOption[] => xs.map((v) => ({ v, label: v }));
const SET = "engine: a setting for it";
const PROJ = "Project instructions";
const EVERY = "What goes with every message";
const QUICK = "Prompts behind quick actions";

export const INSTRUCTIONS_ROWS: Row[] = [
  { id: "instructions.you.file", page: "instructions", card: "Just about you", label: "Just about you", level: 0, control: "custom", bare: true,
    source: { kind: "slot", calls: ["users.personalFile.get", "users.personalFile.set"], reason: "Just about you comes in a later update." } },
  { id: "instructions.project.files", page: "instructions", card: PROJ, label: "Whose files", level: 0, control: "custom", bare: true,
    source: { kind: "slot", calls: ["agents.list", "agents.files.list", "agents.files.get", "agents.files.set"], reason: "Whose files comes in a later update." } },
  coming("instructions.project.family", PROJ, "Project instruction files", "engine: instruction files kept to one model family",
    { help: "Read from the project folder. A file written for one model family is read only when a model of that family answers." }),
  coming("instructions.project.rule-files", PROJ, "Trunks may write rule files", SET, { control: "toggle", help: "A Trunk can add a rule to the project’s rules folder; you see each one." }),
  coming("instructions.project.built-in", PROJ, "Built-in prompts", SET, { help: "The prompts Branch uses for tidying up, naming and more." }),
  coming("instructions.kits.pick", "Kits", "Pick a kit by what’s in the folder", "engine: kits", { control: "toggle", help: "Languages, git and commands found in the folder choose the kit." }),
  coming("instructions.replies.style", "How replies are written", "Reply style", SET, { control: "segmented", options: opts(["Default", "Explanatory", "Learning", "Short"]),
    help: "Explanatory adds why; Learning leaves small parts for you to try." }),
  ...[["rewrite", "Rewrite", "Rewrite this so it is clearer. Keep the meaning and the facts."], ["shorten", "Shorten", "Make this shorter. Keep every fact and number."],
    ["explain", "Explain", "Explain this in plain words for someone new to it."], ["formal", "Make it formal", "Make this formal and polite, ready to send."]]
    .map(([id, label, help]) => coming(`instructions.quick.${id}`, QUICK, label, SET, { level: 1, help })),
  coming("instructions.every.mind", EVERY, "Keep in mind", SET, { level: 1, control: "text", help: "A line or two it reads before every reply." }),
  coming("instructions.every.words", EVERY, "Words filled in for you", SET, { level: 1, help: "Write {{name}} in an instruction or saved prompt and it’s filled in each time." }),
  coming("instructions.every.date", EVERY, "Today’s date and time", SET, { level: 1, control: "toggle", help: "So “tomorrow” and “last week” mean what you mean." }),
  coming("instructions.every.computer", EVERY, "This computer’s details", SET, { level: 1, control: "segmented", options: opts(["Off", "Short", "Full"]),
    help: "The folder, shell, system and git status, so commands fit this computer." }),
  coming("instructions.every.editor", EVERY, "What your editor has open", SET, { level: 1, control: "toggle", help: "The open file and what’s on screen, when an editor is connected." }),
  coming("instructions.every.folders", EVERY, "Instructions in folders it opens", SET, { level: 1, control: "toggle",
    help: "Reads AGENTS.md and similar files in a folder the first time it works there." }),
  coming("instructions.every.reply-in", EVERY, "Reply in", SET, { level: 1, control: "select",
    options: opts(["The language you write in", "English", "Polski", "Español", "Français", "Deutsch", "日本語", "中文"]), help: "The language you write in, unless you pick one." }),
  coming("instructions.every.personality", EVERY, "Personality", SET, { level: 1, control: "select",
    options: opts(["As SOUL.md says", "Helpful", "Brief", "Teacher", "Creative", "Technical", "Playful"]), help: "A ready-made voice on top of SOUL.md. As SOUL.md says leaves it to your file." }),
  coming("instructions.every.examples", EVERY, "Example conversations", SET, { level: 1, help: "Short examples of how you like answers. They go before the conversation." }),
  coming("instructions.rules.extra", "Rules", "Extra instruction files", SET, { level: 1,
    help: "A file, a folder pattern or a web address read at the start, on top of the files above." }),
  coming("instructions.rules.outside", "Rules", "Rules for conversations outside a project", SET, { level: 1 }),
  coming("instructions.rules.org", "Rules", "From your organisation", "engine: rules from your organisation", { level: 1,
    help: "Rules, steps and skills your organisation sends appear here, read only." }),
];
