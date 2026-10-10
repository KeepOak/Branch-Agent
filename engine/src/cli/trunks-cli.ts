// Gateway CLI commands for Trunk templates: export a Trunk to a template file, or create a Trunk from one.
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import { TRUNK_TEMPLATE_FILE_NAME } from "../trunks/trunk-template.js";
import { callGatewayFromCli, type GatewayRpcOpts } from "./gateway-rpc.js";
import { applyParentDefaultHelpAction } from "./program/parent-default-help.js";

type TrunksCliOpts = GatewayRpcOpts & { out?: string; force?: boolean; fromTemplate?: string; name?: string; json?: boolean };

const DEFAULT_TRUNKS_TIMEOUT_MS = 30_000;

function addTrunksGatewayOptions(command: Command) {
  return command
    .option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)")
    .option("--token <token>", "Gateway token (if required)")
    .option("--timeout <ms>", "Timeout in ms", String(DEFAULT_TRUNKS_TIMEOUT_MS))
    .option("--json", "Output JSON", false);
}

/** A bundled template id is a bare name. Anything with a path separator or a template suffix is a file. */
export function templateSourceFromArg(value: string, cwd: string): { templateId: string } | { templatePath: string } {
  const looksLikeFile = value.includes("/") || value.includes("\\") || value.endsWith(".json");
  return looksLikeFile ? { templatePath: path.resolve(cwd, value) } : { templateId: value };
}

type ExportResult = { file: string; template: unknown; warnings?: string[] };
type CreateResult = { agentId: string; workspace?: string; warnings?: string[] };

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
      .action(async (agentId: string, opts: TrunksCliOpts) => {
        const target = path.resolve(process.cwd(), opts.out ?? TRUNK_TEMPLATE_FILE_NAME);
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
      .description("Create a Trunk from a bundled template id or a template file")
      .requiredOption("--from-template <idOrPath>", "A bundled template id, or a path to a .trunk-template.json file")
      .option("--name <name>", "Name for the new Trunk (defaults to the template's name)")
      .action(async (opts: TrunksCliOpts) => {
        const source = templateSourceFromArg(opts.fromTemplate ?? "", process.cwd());
        const result = (await callGatewayFromCli(
          "trunks.template.create",
          opts,
          { ...source, ...(opts.name ? { name: opts.name } : {}) },
          { scopes: ["operator.admin"] },
        )) as CreateResult;
        if (opts.json === true) {
          process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return;
        }
        process.stdout.write(`Created Trunk ${result.agentId}${result.workspace ? ` in ${result.workspace}` : ""}\n`);
        writeWarnings(result.warnings);
      }),
  );
}
