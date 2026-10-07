import type { Command } from "commander";
import { previewCronSchedule } from "../../cron/schedule-preview.js";
import { defaultRuntime, type RuntimeEnv } from "../../runtime.js";
import { setCommandJsonMode } from "../program/json-mode.js";
import { CronCliError } from "./cron-cli-error.js";

type PreviewOptions = { tz: string; count: string; from?: string; json?: boolean };

function previewStart(raw: string | undefined, now: () => number): number {
  if (raw === undefined) return now();
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/iu.exec(raw);
  const local = match ? new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`) : null;
  if (!match || !local || Number(match[1]) < 1 ||
    local.getUTCFullYear() !== Number(match[1]) || local.getUTCMonth() + 1 !== Number(match[2]) ||
    local.getUTCDate() !== Number(match[3]) || !Number.isFinite(Date.parse(raw))) {
    throw new Error("--from must be an ISO timestamp with an explicit timezone");
  }
  return Date.parse(raw);
}

/** Local advisory calculation: no Gateway request, persisted job, or timer. */
export function registerCronPreviewCommand(
  parent: Command,
  runtime: Pick<RuntimeEnv, "log"> = defaultRuntime,
  now: () => number = Date.now,
): Command {
  const command = parent.command("preview <expression>")
    .description("Preview upcoming cron occurrences with native scheduler timezone semantics")
    .requiredOption("--tz <timezone>", "IANA timezone for the schedule")
    .option("--count <number>", "Occurrence count (1 through 10)", "5")
    .option("--from <timestamp>", "Reference ISO timestamp with timezone (default now)")
    .option("--json", "Output UTC and local occurrence timestamps as JSON", false)
    .action((expression: string, options: PreviewOptions) => {
      try {
        if (!/^\d+$/u.test(options.count)) throw new Error("Preview count must be an integer from 1 to 10");
        const result = previewCronSchedule({ cron: expression, timezone: options.tz,
          count: Number(options.count), startAtMs: previewStart(options.from, now) });
        runtime.log(options.json ? JSON.stringify(result, null, 2) : [
          `Advisory occurrences in ${result.timezone}; actual runs retain job staggering and admission policies.`,
          ...result.occurrences.map((item) => `${item.runAt}\t${item.localTime}`),
        ].join("\n"));
      } catch (error) {
        throw new CronCliError(error instanceof Error ? error : String(error));
      }
    });
  setCommandJsonMode(command, "output");
  return command;
}
