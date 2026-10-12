import { sanitizeTerminalText } from "../../../packages/terminal-core/src/safe-text.js";
import type { Command } from "commander";
import { readPipelineDefinitions } from "../../cron/pipeline-definitions.js";
import { projectCronPipelines, type PipelineInventoryJob } from "../../cron/pipeline-projection.js";
import { defaultRuntime, type RuntimeEnv } from "../../runtime.js";
import { addGatewayClientOptions, type GatewayRpcOpts } from "../gateway-rpc.js";
import { setCommandJsonMode } from "../program/json-mode.js";
import { CronCliError } from "./cron-cli-error.js";
import { listCronJobsFromGateway } from "./list-jobs.js";

type PipelineCommandOptions = GatewayRpcOpts & { file?: string; json?: boolean };
type PipelineDependencies = {
  listJobs: (opts: GatewayRpcOpts, filters: { includeDisabled: boolean }) => Promise<{ jobs: readonly PipelineInventoryJob[] }>;
  env: NodeJS.ProcessEnv;
};

export function registerCronPipelinesCommand(
  parent: Command,
  runtime: Pick<RuntimeEnv, "log"> = defaultRuntime,
  deps: PipelineDependencies = { listJobs: listCronJobsFromGateway, env: process.env },
): Command {
  const command = parent.command("pipelines")
    .description("Show declared pipeline edges against caller-visible automation jobs")
    .option("--file <path>", "Pipeline JSON file (default WORKSPACE_PATH/clawport/pipelines.json)")
    .option("--json", "Output graph and scoped reference resolution as JSON", false)
    .action(async (opts: PipelineCommandOptions) => {
      try {
        const definitions = readPipelineDefinitions(opts.file, deps.env);
        const inventory = definitions.pipelines.length ? await deps.listJobs(opts, { includeDisabled: true }) : { jobs: [] };
        const result = { definitionFile: definitions.path, ...projectCronPipelines(definitions.pipelines, inventory.jobs) };
        if (opts.json) {
          runtime.log(JSON.stringify(result, null, 2));
          return;
        }
        const lines = [result.scope];
        for (const pipeline of definitions.pipelines) {
          lines.push(`Pipeline: ${pipeline.name}`);
          for (const edge of pipeline.edges) lines.push(`  ${edge.from} --[${edge.artifact}]--> ${edge.to}`);
        }
        for (const reference of result.references) lines.push(`Reference: ${reference.name} (${reference.resolution}${reference.visibleJobIds.length ? `: ${reference.visibleJobIds.join(", ")}` : ""})`);
        if (!definitions.pipelines.length) lines.push("No pipeline definitions configured.");
        runtime.log(lines.map(sanitizeTerminalText).join("\n"));
      } catch (error) {
        throw new CronCliError(error instanceof Error ? error : String(error));
      }
    });
  addGatewayClientOptions(command);
  setCommandJsonMode(command, "output");
  return command;
}
