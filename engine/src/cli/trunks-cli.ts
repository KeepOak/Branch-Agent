// Gateway CLI commands for Trunk templates: export a Trunk to a template file, or create a Trunk from one.
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { TRUNK_TEMPLATE_LINK_PREFIX } from "../trunks/trunk-template-link.js";
import { TRUNK_TEMPLATE_FILE_NAME } from "../trunks/trunk-template.js";
import { callGatewayFromCli, type GatewayRpcOpts } from "./gateway-rpc.js";
import { applyParentDefaultHelpAction } from "./program/parent-default-help.js";

type TrunksCliOpts = GatewayRpcOpts & {
  out?: string;
  force?: boolean;
  link?: boolean;
  fromTemplate?: string;
  name?: string;
  json?: boolean;
  answer?: string[];
  timezone?: string;
  agent?: string;
  goal?: string;
};

/** Collects repeated --answer id=value options. */
function collectAnswer(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/** "topics=AI news" -> { topics: "AI news" }. An entry without "=" is an error, so a typo never passes silently. */
export function parseAnswerOptions(values: readonly string[] | undefined): Record<string, string> {
  const answers: Record<string, string> = {};
  for (const value of values ?? []) {
    const at = value.indexOf("=");
    if (at <= 0) {
      throw new Error("--answer takes id=value, such as --answer topics=\"AI news\".");
    }
    answers[value.slice(0, at).trim()] = value.slice(at + 1).trim();
  }
  return answers;
}

const DEFAULT_TRUNKS_TIMEOUT_MS = 30_000;

function addTrunksGatewayOptions(command: Command) {
  return command
    .option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)")
    .option("--token <token>", "Gateway token (if required)")
    .option("--timeout <ms>", "Timeout in ms", String(DEFAULT_TRUNKS_TIMEOUT_MS))
    .option("--json", "Output JSON", false);
}

/**
 * A template link is passed through as a link. A catalog id is a bare name or "imported:<slug>".
 * Anything with a path separator or a template suffix is a file.
 */
export function templateSourceFromArg(
  value: string,
  cwd: string,
): { templateId: string } | { templatePath: string } | { link: string } {
  if (value.trim().startsWith(TRUNK_TEMPLATE_LINK_PREFIX)) {
    return { link: value.trim() };
  }
  const looksLikeFile = value.includes("/") || value.includes("\\") || value.endsWith(".json");
  return looksLikeFile ? { templatePath: path.resolve(cwd, value) } : { templateId: value };
}

type ExportResult = { file: string; template: unknown; link?: string; warnings?: string[] };
type CreateResult = {
  agentId: string;
  workspace?: string;
  routines?: Array<{ id: string; name: string }>;
  connections?: Array<{ id: string; ready: boolean }>;
  warnings?: string[];
  firstRun?: { timezone: string; started: boolean };
};
type StartersResult = {
  timezone: string;
  reason?: string;
  offer: Array<{ id: string; name: string; pitch: string; questions: Array<{ id: string; prompt: string; default: string }> }>;
};
type CardResult = { card: { name: string; started: boolean; summary: string; nextRunAtMs?: number }; warnings?: string[] };
type ListResult = { templates: Array<{ id: string; source: string; name: string; description: string; routines: number }> };

/** What the owner still has to do after a create: approve routines and set up channels. */
export function createFollowUps(result: CreateResult): string[] {
  const lines = result.firstRun
    ? [`Its routines are paused and run in ${result.firstRun.timezone} once you start it: branch trunks start ${result.agentId}`]
    : (result.routines ?? []).map(
        (routine) => `Routine "${routine.name}" was added turned off. Turn it on in Automations once you approve it.`,
      );
  for (const connection of result.connections ?? []) {
    if (!connection.ready) {
      lines.push(`This Trunk talks on ${connection.id}, which is not set up here. Set it up in Channels.`);
    }
  }
  return lines;
}

function writeWarnings(warnings: string[] | undefined): void {
  for (const warning of warnings ?? []) {
    process.stdout.write(`warning: ${warning}\n`);
  }
}

/** Without --force the write is exclusive, so a file created during the gateway call is never overwritten. */
async function writeTemplateFile(target: string, template: unknown, force: boolean): Promise<void> {
  const body = `${JSON.stringify(template, null, 2)}\n`;
  try {
    await writeFile(target, body, { encoding: "utf8", flag: force ? "w" : "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`${target} already exists. Pass --force to overwrite it.`, { cause: error });
    }
    throw error;
  }
}

export function registerTrunksCli(program: Command) {
  const trunks = program
    .command("trunks")
    .description("Export a Trunk to a template, or create a Trunk from one");
  applyParentDefaultHelpAction(trunks);

  addTrunksGatewayOptions(
    trunks
      .command("export <agentId>")
      .description("Write a Trunk's template file (secret-free, no memory or accounts)")
      .option("--out <file>", "Where to write the template", TRUNK_TEMPLATE_FILE_NAME)
      .option("--force", "Overwrite the file if it exists", false)
      .option("--link", "Print a template link instead of writing a file", false)
      .action(async (agentId: string, opts: TrunksCliOpts) => {
        const target = path.resolve(process.cwd(), opts.out ?? TRUNK_TEMPLATE_FILE_NAME);
        if (opts.link === true) {
          const shared = (await callGatewayFromCli(
            "trunks.template.export",
            opts,
            { agentId },
            { scopes: ["operator.read"] },
          )) as ExportResult;
          process.stdout.write(
            opts.json === true
              ? `${JSON.stringify({ link: shared.link, warnings: shared.warnings ?? [] }, null, 2)}\n`
              : `${shared.link ?? ""}\n`,
          );
          if (opts.json !== true) {
            writeWarnings(shared.warnings);
          }
          return;
        }
        if (existsSync(target) && opts.force !== true) {
          throw new Error(`${target} already exists. Pass --force to overwrite it.`);
        }
        const result = (await callGatewayFromCli(
          "trunks.template.export",
          opts,
          { agentId },
          { scopes: ["operator.read"] },
        )) as ExportResult;
        await writeTemplateFile(target, result.template, opts.force === true);
        if (opts.json === true) {
          process.stdout.write(`${JSON.stringify({ file: target, warnings: result.warnings ?? [] }, null, 2)}\n`);
          return;
        }
        process.stdout.write(`Wrote ${target}\n`);
        writeWarnings(result.warnings);
      }),
  );

  addTrunksGatewayOptions(
    trunks
      .command("create")
      .description("Create a Trunk from a catalog template id, a template file, or a template link")
      .requiredOption("--from-template <idPathOrLink>", "A catalog template id, a path to a .trunk-template.json file, or a branch-template: link")
      .option("--name <name>", "Name for the new Trunk (defaults to the template's name)")
      .option("--answer <id=value>", "A first-run answer; repeat for each question (unanswered ones take their default)", collectAnswer)
      .option("--timezone <zone>", "Timezone for the template's routines (defaults to this machine's)")
      .action(async (opts: TrunksCliOpts) => {
        const source = templateSourceFromArg(opts.fromTemplate ?? "", process.cwd());
        const answers = parseAnswerOptions(opts.answer);
        const result = (await callGatewayFromCli(
          "trunks.template.create",
          opts,
          {
            ...source,
            ...(opts.name ? { name: opts.name } : {}),
            ...(Object.keys(answers).length ? { answers } : {}),
            ...(opts.timezone ? { timezone: opts.timezone } : {}),
          },
          { scopes: ["operator.admin"] },
        )) as CreateResult;
        if (opts.json === true) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return;
        }
        process.stdout.write(`Created Trunk ${result.agentId}${result.workspace ? ` in ${result.workspace}` : ""}\n`);
        for (const line of createFollowUps(result)) {
          process.stdout.write(`${line}\n`);
        }
        writeWarnings(result.warnings);
      }),
  );

  addTrunksGatewayOptions(
    trunks
      .command("templates")
      .description("List the Trunk template catalog: bundled templates and imported ones")
      .action(async (opts: TrunksCliOpts) => {
        const result = (await callGatewayFromCli(
          "trunks.template.list",
          opts,
          {},
          { scopes: ["operator.read"] },
        )) as ListResult;
        if (opts.json === true) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return;
        }
        for (const template of result.templates) {
          const routines = template.routines ? ` · ${template.routines} routine${template.routines === 1 ? "" : "s"}` : "";
          process.stdout.write(`${template.id}\t${template.name} (${template.source}${routines})${template.description ? ` - ${template.description}` : ""}\n`);
        }
      }),
  );

  addTrunksGatewayOptions(
    trunks
      .command("starters")
      .description("The three starter teammates the main Trunk offers in its first conversation")
      .option("--agent <agentId>", "Ask as this Trunk; only the main Trunk gets an offer")
      .option("--goal <text>", "The owner's goal, so the best-fitting teammates come first")
      .action(async (opts: TrunksCliOpts) => {
        const result = (await callGatewayFromCli(
          "trunks.template.starters",
          opts,
          { ...(opts.agent ? { agentId: opts.agent } : {}), ...(opts.goal ? { goal: opts.goal } : {}) },
          { scopes: ["operator.read"] },
        )) as StartersResult;
        if (opts.json === true) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return;
        }
        if (result.offer.length === 0) {
          process.stdout.write(`${result.reason ?? "No starter teammates are available."}\n`);
          return;
        }
        for (const offer of result.offer) {
          process.stdout.write(`${offer.id}\t${offer.pitch}\n`);
          for (const question of offer.questions) {
            process.stdout.write(`  ${question.id}: ${question.prompt} (default: ${question.default})\n`);
          }
        }
        process.stdout.write(`Timezone: ${result.timezone}\n`);
      }),
  );

  for (const [verb, method, description] of [
    ["start", "trunks.template.start", "Turn on a new teammate's paused routines (the owner's Start)"],
    ["stop", "trunks.template.stop", "Turn a teammate's starter routines off again"],
  ] as const) {
    addTrunksGatewayOptions(
      trunks
        .command(`${verb} <agentId>`)
        .description(description)
        .action(async (agentId: string, opts: TrunksCliOpts) => {
          const result = (await callGatewayFromCli(method, opts, { agentId }, { scopes: ["operator.admin"] })) as CardResult;
          if (opts.json === true) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
          }
          const next = result.card.nextRunAtMs ? ` Next run: ${new Date(result.card.nextRunAtMs).toLocaleString()}.` : "";
          process.stdout.write(`${result.card.name} is ${result.card.started ? "started" : "stopped"}. ${result.card.summary}${next}\n`);
          writeWarnings(result.warnings);
        }),
    );
  }
}
