// Automation export and import, copied from cline/cline apps/cli/src/commands/schedule/
// import-export.ts (AUTOMATION-0048): export one job to a JSON or YAML file and create
// a job from such a file, including a job exported from another Branch store.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import type { Command } from "commander";
import { defaultRuntime } from "../../runtime.js";
import { addGatewayClientOptions, callGatewayFromCli } from "../gateway-rpc.js";
import { CronCliError } from "./cron-cli-error.js";
import { createCronOutputCommand } from "./output-mode.js";
import { handleCronCliError, printCronJson, requireCronJobId } from "./shared.js";

/** Definition fields `cron.add` accepts; scheduler state and ids stay with the source store. */
const PORTABLE_CRON_FIELDS = [
  "name",
  "declarationKey",
  "displayName",
  "agentId",
  "sessionKey",
  "description",
  "enabled",
  "deleteAfterRun",
  "schedule",
  "pacing",
  "trigger",
  "sessionTarget",
  "wakeMode",
  "payload",
  "delivery",
  "failureAlert",
] as const;

export function isJsonPath(path: string): boolean {
  return extname(path).toLowerCase() === ".json";
}

/** Keeps only the definition fields of an exported (or foreign) job. */
export function toPortableCronJob(job: unknown): Record<string, unknown> {
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new CronCliError("automation file must contain one automation object");
  }
  const source = job as Record<string, unknown>;
  const portable: Record<string, unknown> = {};
  for (const field of PORTABLE_CRON_FIELDS) {
    if (source[field] !== undefined) {
      portable[field] = source[field];
    }
  }
  return portable;
}

async function serializeCronJob(job: Record<string, unknown>, json: boolean): Promise<string> {
  if (json) {
    return `${JSON.stringify(job, null, 2)}\n`;
  }
  const yaml = await import("yaml");
  return yaml.stringify(job);
}

/** Parses an automation file written by `cron export` (JSON by extension, otherwise YAML). */
export async function parseCronJobFile(sourcePath: string, raw: string): Promise<unknown> {
  if (isJsonPath(sourcePath)) {
    return JSON.parse(raw) as unknown;
  }
  const yaml = await import("yaml");
  return yaml.parse(raw) as unknown;
}

export function registerCronTransferCommands(cron: Command) {
  addGatewayClientOptions(
    cron
      .command("export")
      .description("Export an automation to a JSON or YAML file")
      .argument("<id>", "Job id")
      .option("--json", "Write JSON instead of YAML")
      .option("--to <path>", "Output file path (.json writes JSON, anything else YAML)")
      .action(async (idArg, opts) => {
        try {
          const id = requireCronJobId(idArg);
          const job = toPortableCronJob(await callGatewayFromCli("cron.get", opts, { id }));
          const toPath = typeof opts.to === "string" && opts.to.length > 0 ? opts.to : undefined;
          if (!toPath) {
            defaultRuntime.log((await serializeCronJob(job, opts.json === true)).trimEnd());
            return;
          }
          const resolvedPath = isAbsolute(toPath) ? toPath : resolve(process.cwd(), toPath);
          await mkdir(dirname(resolvedPath), { recursive: true });
          const useJson = opts.json === true || isJsonPath(resolvedPath);
          await writeFile(resolvedPath, await serializeCronJob(job, useJson), "utf8");
          defaultRuntime.log(`Exported automation ${id} to ${resolvedPath}`);
        } catch (err) {
          handleCronCliError(err);
        }
      }),
  );

  addGatewayClientOptions(
    createCronOutputCommand(cron, "import")
      .description("Create an automation from a file written by cron export")
      .argument("<path>", "Source file path")
      .action(async (sourcePath: string, opts) => {
        try {
          const raw = await readFile(sourcePath, "utf8");
          const job = toPortableCronJob(await parseCronJobFile(sourcePath, raw));
          if (typeof job.name !== "string" || !job.name.trim()) {
            throw new CronCliError("automation file requires a name");
          }
          printCronJson(await callGatewayFromCli("cron.add", opts, job));
        } catch (err) {
          handleCronCliError(err);
        }
      }),
  );
}
