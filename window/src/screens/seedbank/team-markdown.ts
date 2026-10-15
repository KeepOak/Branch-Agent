// From milind-soni/OpenMausBot@3bbe01e85a984a695f09dd543cd10c41f2ec276b:shared/package-format.ts (markdownDocument: the frontmatter match; Apache-2.0). Changed for Branch: a small team format of our own (branch.team), with one ## section per Trunk, no YAML parser and no playbook sections. Secrets are scrubbed here, before anything reaches the engine.
//
// A team file is Markdown with a frontmatter block, then one ## section per Trunk:
//
//   ---
//   format: branch.team
//   version: 1
//   name: Sales desk
//   description: Finds and works leads.
//   ---
//
//   ## Scout
//   model: gpt-5.5
//   description: Finds leads.
//   permissions:
//   - Reads the web
//   routine: Morning brief | 0 8 * * * | Summarise overnight leads.
//
//   Everything after the metadata lines is the Trunk's instructions.
import { SECRETS } from "./seed";

export const TEAM_FORMAT = "branch.team";
export const TEAM_VERSION = 1;
export const TEAM_MAX_BYTES = 256 * 1024;
export const TEAM_MAX_BOTS = 12;
const BOT_MAX_ROUTINES = 10;
const BOT_MAX_PERMISSIONS = 20;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const TEAM_MARK = /^---\r?\n[\s\S]*?^format:\s*branch\.team\s*$/m;
const CRON = /^\S+( \S+){4}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;

export type TeamRoutine = { name: string; cron: string; prompt: string };
export type TeamBot = { name: string; model: string; description: string; permissions: string[]; routines: TeamRoutine[]; instructions: string };
export type TeamFile = { name: string; description: string; bots: TeamBot[]; removed: number };
export type TeamParse = { ok: true; team: TeamFile } | { ok: false; notTeam: boolean; reason: string };

/** True when the text opens with a team frontmatter block, whether or not the rest of it is valid. */
export const looksLikeTeam = (text: string): boolean => TEAM_MARK.test(text);

/** Replaces anything that looks like a key or token. Returns the cleaned text and how many pieces it replaced. */
export function scrub(text: string): { text: string; removed: number } {
  let removed = 0;
  let out = text.replace(PRIVATE_KEY_BLOCK, () => { removed++; return "[removed secret]"; });
  for (const pattern of SECRETS) {
    out = out.replace(new RegExp(pattern.source, "g"), () => { removed++; return "[removed secret]"; });
  }
  return { text: out, removed };
}

const notTeam = (reason: string): TeamParse => ({ ok: false, notTeam: true, reason });
const broken = (reason: string): TeamParse => ({ ok: false, notTeam: false, reason });

/** The key: value lines of the frontmatter. */
function readPairs(block: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([a-z]+):\s*(.*)$/);
    if (match) pairs[match[1]!] = match[2]!.trim();
  }
  return pairs;
}

/** Each ## heading and the text under it, in order. */
function splitBots(body: string): { name: string; body: string }[] {
  const parts = body.split(/^## +(.+?)\s*$/m);
  const sections: { name: string; body: string }[] = [];
  for (let i = 1; i + 1 < parts.length; i += 2) sections.push({ name: parts[i]!, body: parts[i + 1]! });
  return sections;
}

type Meta = { model: string; description: string; permissions: string[]; routines: string[] };

/** The metadata lines at the top of one Trunk's section; the first other line starts the instructions. */
function readMeta(lines: string[]): { meta: Meta; rest: number } {
  const meta: Meta = { model: "", description: "", permissions: [], routines: [] };
  let list: string[] | null = null;
  let i = 0;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    if (list && /^- /.test(line)) { list.push(line.slice(2).trim()); continue; }
    list = null;
    const match = line.match(/^(model|description|permissions|routine):\s*(.*)$/);
    if (!match) break;
    const [, key, value] = match as [string, string, string];
    if (key === "permissions") list = meta.permissions;
    else if (key === "routine") meta.routines.push(value.trim());
    else if (key === "model") meta.model = value.trim();
    else meta.description = value.trim();
  }
  return { meta, rest: i };
}

/** "name | cron | prompt", or null when the line is not that shape. */
function parseRoutine(line: string): TeamRoutine | null {
  const parts = line.split("|").map((part) => part.trim());
  if (parts.length !== 3 || !parts[0] || !CRON.test(parts[1]!) || !parts[2]) return null;
  return { name: parts[0], cron: parts[1]!, prompt: parts[2] };
}

/** One Trunk from its section. The second value is how many secret-looking pieces were replaced. */
function botFrom(heading: string, body: string): { ok: true; bot: TeamBot; removed: number } | { ok: false; reason: string } {
  const lines = body.split(/\r?\n/);
  const { meta, rest } = readMeta(lines);
  const name = scrub(heading);
  const instructions = scrub(lines.slice(rest).join("\n").trim());
  const description = scrub(meta.description);
  const permissions = meta.permissions.map(scrub);
  const routines = meta.routines.map((line) => parseRoutine(scrub(line).text));
  if (!instructions.text) return { ok: false, reason: `${heading} needs instructions under its heading.` };
  if (meta.model && !MODEL.test(meta.model)) return { ok: false, reason: `The model for ${heading} isn’t a model name.` };
  if (routines.some((routine) => !routine)) return { ok: false, reason: `A routine on ${heading} needs "name | five-field cron | prompt".` };
  if (routines.length > BOT_MAX_ROUTINES || permissions.length > BOT_MAX_PERMISSIONS) return { ok: false, reason: `${heading} has too many routines or permissions.` };
  const removed = name.removed + instructions.removed + description.removed + permissions.reduce((n, p) => n + p.removed, 0) + scrub(meta.routines.join("\n")).removed;
  const bot: TeamBot = {
    name: name.text,
    model: meta.model,
    description: description.text,
    permissions: permissions.map((p) => p.text).filter(Boolean),
    routines: routines.filter((routine): routine is TeamRoutine => routine !== null),
    instructions: instructions.text,
  };
  return { ok: true, bot, removed };
}

/** Reads a whole team file. A text that is not a team file says so with notTeam, so a paste can fall through. */
export function parseTeamMarkdown(text: string): TeamParse {
  if (new TextEncoder().encode(text).length > TEAM_MAX_BYTES) return broken("This team file is too large. Keep it under 256 KB.");
  const frontmatter = text.match(FRONTMATTER);
  if (!frontmatter || !looksLikeTeam(text)) return notTeam("That isn’t a team file.");
  const head = readPairs(frontmatter[1]!);
  if (head.format !== TEAM_FORMAT) return notTeam("That isn’t a team file.");
  if (head.version !== String(TEAM_VERSION)) return broken("This team file's version isn't supported.");
  if (!head.name) return broken("A team file needs a name in its frontmatter.");
  const sections = splitBots(text.slice(frontmatter[0].length));
  if (!sections.length) return broken("This team has no Trunks. Add a ## section for each one.");
  if (sections.length > TEAM_MAX_BOTS) return broken(`A team can have at most ${TEAM_MAX_BOTS} Trunks.`);
  const bots: TeamBot[] = [];
  let removed = 0;
  for (const section of sections) {
    const made = botFrom(section.name, section.body);
    if (!made.ok) return broken(made.reason);
    bots.push(made.bot);
    removed += made.removed;
  }
  const name = scrub(head.name), description = scrub(head.description ?? "");
  return { ok: true, team: { name: name.text, description: description.text, bots, removed: removed + name.removed + description.removed } };
}

/** The trunks.template.create payload for one Trunk: the shape the engine's template reader accepts. */
export function templateFor(bot: TeamBot) {
  return {
    format: "branch.trunk-template",
    version: 1,
    name: bot.name,
    description: bot.description,
    persona: { agentsMd: bot.instructions },
    skills: [],
    toolsets: {},
    permissions: bot.permissions,
    ...(bot.model ? { model: { family: bot.model } } : {}),
    ...(bot.routines.length ? { automations: bot.routines } : {}),
  };
}
