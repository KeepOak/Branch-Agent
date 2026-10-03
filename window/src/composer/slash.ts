// The slash drawer (DESIGN-SPEC §4.3.5): the engine's own command list (commands.list), in Branch's words.
// Commands run in the engine when the text is sent (chat.send); the drawer only helps write them.
import { list, rec, str } from "./engine";

export type Choice = { value: string; label: string };

export type SlashCommand = {
  name: string;
  aliases: string[];
  hint: string;
  description: string;
  /** "· <plugin or skill>" for commands a plugin or skill adds. */
  owner: string;
  builtIn: boolean;
  choices: Choice[];
  /** The choices come from the model (for /think). */
  dynamic: boolean;
};

/** Branch's words for the commands the spec names (§4.3.5 and its Parity adds). Others keep the engine's line. */
const WORDS: Record<string, { hint?: string; line: string }> = {
  goal: { hint: "<what should be true>", line: "keep working until a goal is met" },
  new: { line: "start a fresh conversation" },
  usage: { hint: "[off, tokens, full or cost]", line: "what each account has left" },
  btw: { hint: "<question>", line: "a quick question on the side, answered in the Side chat tab" },
  think: { hint: "<level>", line: "how hard it thinks here" },
  loop: { hint: "<every> <what>", line: "repeat a prompt on a clock" },
  name: { hint: "<title>", line: "Name or rename this conversation" },
  help: { line: "every command you can use here" },
  commands: { line: "list every command" },
  status: { line: "what is happening here now" },
  models: { hint: "[service]", line: "the models you can use" },
  model: { hint: "[name] [here, trunk or everywhere]", line: "which model answers" },
  fast: { hint: "[on, off, ultrafast, auto, default or status]", line: "how fast it answers here" },
  verbose: { hint: "<on, full or off>", line: "send each step as its own message" },
  reasoning: { hint: "<on, off or stream>", line: "whether the thinking is sent with each reply" },
  tools: { hint: "[short or full]", line: "the tools this conversation can use" },
  whoami: { line: "who you are here and what you may do" },
  stop: { line: "stop what it is doing" },
  steer: { hint: "<message>", line: "tell it what to change while it works" },
  queue: { hint: "[wait, steer, gather or restart]", line: "what messages sent while it works do, here" },
  reset: { hint: "[first message]", line: "start this conversation over, with a first message" },
  exec: { line: "where and how commands run here" },
  login: { hint: "[service]", line: "sign in to a model service" },
  allowlist: { line: "Who may message Branch in this chat app" },
  tts: { hint: "<on|off|status|engine|limit|summary|say>", line: "Reading replies aloud, here" },
  restart: { line: "Restart the engine" },
  diagnostics: { hint: "[note]", line: "Make a support report" },
  trace: { hint: "<on|off|raw>", line: "show plugin trace lines here" },
  "export-trajectory": { hint: "[folder]", line: "save this conversation’s steps as a bundle" },
  compact: { hint: "<what to keep>", line: "Tidy up this conversation now" },
  context: { line: "What goes with each message" },
  pair: { line: "Pair a phone from here" },
  update: { line: "Update Branch" },
  dashboard: { hint: "[what you want]", line: "build or change this conversation's dashboard" },
};

/** Left out of the list until their first letters are typed (§4.3.5 "/commands" row). */
export const LESS_USED = new Set(["commands", "whoami", "queue", "redirect", "elevated", "exec"]);

function argHint(args: ReturnType<typeof list>): string {
  return args.map((a) => `<${str(a.name)}>`).join(" ");
}

function readChoices(args: ReturnType<typeof list>): Choice[] {
  const first = args[0];
  return first ? list(first.choices).map((c) => ({ value: str(c.value), label: str(c.label) || str(c.value) })) : [];
}

export function readCommands(result: unknown): SlashCommand[] {
  const rows = list(rec(result).commands);
  const builtIns = new Set(rows.filter((r) => str(r.source) === "native").map((r) => str(r.name)));
  return rows
    .filter((r) => str(r.name))
    .map((r) => {
      const name = str(r.name);
      const args = list(r.args);
      const builtIn = str(r.source) === "native";
      const owner = builtIn ? "" : str(r.pluginId) || str(r.skillName) || str(r.source);
      const shown = !builtIn && builtIns.has(name) && owner ? `${owner}:${name}` : name;
      const words = builtIn ? WORDS[name] : undefined;
      return {
        name: shown,
        aliases: (Array.isArray(r.textAliases) ? r.textAliases : []).map(str).map((a) => a.replace(/^\//, "")).filter(Boolean),
        hint: words?.hint ?? argHint(args),
        description: words?.line ?? str(r.description),
        owner,
        builtIn,
        choices: readChoices(args),
        dynamic: args[0]?.dynamic === true,
      };
    })
    .sort((a, b) => Number(b.builtIn) - Number(a.builtIn));
}

/** The drawer is open while the box starts with "/" and holds no space yet. Returns the typed word, or null. */
export function slashQuery(text: string): string | null {
  const m = /^\/(\S*)$/.exec(text);
  return m ? m[1].toLowerCase() : null;
}

/** Commands matching the typed start, built-ins first; less-used ones only once typed. */
export function filterCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  return commands.filter((c) => {
    const names = [c.name, ...c.aliases];
    if (!names.some((n) => n.toLowerCase().startsWith(query))) {
      return false;
    }
    return query.length > 0 || !LESS_USED.has(c.name);
  });
}

/** After "/<command> ", the command and the typed choice prefix, when the command has set choices. */
export function argQuery(text: string, commands: readonly SlashCommand[]): { command: SlashCommand; prefix: string } | null {
  const m = /^\/(\S+) (\S*)$/.exec(text);
  if (!m) {
    return null;
  }
  const word = m[1].toLowerCase();
  const command = commands.find((c) => c.name === word || c.aliases.includes(word));
  if (!command || (command.choices.length === 0 && !command.dynamic)) {
    return null;
  }
  return { command, prefix: m[2].toLowerCase() };
}

export function filterChoices(choices: readonly Choice[], prefix: string): Choice[] {
  return choices.filter((c) => c.value.toLowerCase().startsWith(prefix) || c.label.toLowerCase().startsWith(prefix));
}

/** The command word of a draft that starts with "/", lower case, without the slash. */
export function commandWord(text: string): string {
  const m = /^\/(\S+)/.exec(text.trim());
  return m ? m[1].toLowerCase() : "";
}

/** The words after the command word. */
export function commandRest(text: string): string {
  return text.trim().replace(/^\/\S+\s*/, "");
}
