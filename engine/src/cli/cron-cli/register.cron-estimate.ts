// CLI adapter for pinned loop-cost scenarios; action performs no Gateway operation.
import type { Command } from "commander";
import { assertValidLevel, estimateCost, formatEstimateHuman } from "../../cron/loop-cost-estimator.js";
import { LOOP_COST_REGISTRY } from "../../cron/loop-cost-registry.js";
import { defaultRuntime, type RuntimeEnv } from "../../runtime.js";
import { setCommandJsonMode } from "../program/json-mode.js";
import { CronCliError } from "./cron-cli-error.js";

type EstimateOptions = {
  pattern: string;
  cadence?: string;
  level: string;
  orchestration: string;
  conservative?: boolean;
  withCaching?: boolean;
  json?: boolean;
  list?: boolean;
};

/** Source defaults retained: daily-triage, L1, single; source scenario data only. */
export function registerCronEstimateCommand(
  parent: Command,
  runtime: Pick<RuntimeEnv, "log"> = defaultRuntime,
): Command {
  const command = parent.command("estimate")
    .description("Estimate daily token scenarios for a loop pattern without enabling it")
    .option("-p, --pattern <id>", "Source loop pattern id", "daily-triage")
    .option("-c, --cadence <spec>", "Override source cadence, e.g. 15m or 5m-15m")
    .option("-l, --level <level>", "Readiness level: L1, L2 or L3", "L1")
    .option("-o, --orchestration <spec>", "single, maker-checker, parallel:N or debate:R", "single")
    .option("--conservative", "Use the slower cadence in a source range", false)
    .option("--with-caching", "Include the source stable-fraction cache discount scenario", false)
    .option("--json", "Output JSON instead of text", false)
    .option("--list", "List source loop pattern ids", false)
    .action((options: EstimateOptions) => {
      if (options.list) {
        const patterns = LOOP_COST_REGISTRY.patterns;
        runtime.log(options.json ? JSON.stringify(patterns.map(({ id, token_cost, cadence }) => ({ id, token_cost, cadence })), null, 2) : patterns.map((p) => `${p.id}\t${p.token_cost}\t${p.cadence}`).join("\n"));
        return;
      }
      try {
        const pattern = LOOP_COST_REGISTRY.patterns.find((p) => p.id === options.pattern);
        if (!pattern) throw new Error(`Unknown pattern: ${options.pattern}. Use --list for ids.`);
        assertValidLevel(options.level);
        const result = estimateCost({ pattern, cadence: options.cadence, level: options.level,
          conservative: options.conservative, orchestration: options.orchestration, withCaching: options.withCaching });
        const basis = "Pinned upstream heuristic token coefficients and readiness mix; no measured usage or model pricing. Optional cache scenario uses source 0.1 cost weighting of stable tokens.";
        runtime.log(options.json ? JSON.stringify({ ...result, basis, source: "cobusgreyling/loop-engineering@10a5f859a16a69d3ee4942b8b7b8b3af781c08e2" }, null, 2) : formatEstimateHuman(result));
      } catch (error) {
        throw new CronCliError(error instanceof Error ? error : String(error));
      }
    });
  setCommandJsonMode(command, "output");
  return command;
}
