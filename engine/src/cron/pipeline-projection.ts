import { describeScheduleForDisplay } from "./schedule-humanize.js";
import type { CronJob } from "../../packages/gateway-protocol/src/schema/cron.types.js";
import { getAllPipelineJobNames, type Pipeline } from "./pipeline-definitions.js";
import { buildPipelineLayout, computePipelineContext, type PipelineLayoutJob } from "./pipeline-layout.js";

/** Both canonical compact Gateway pages and full job rows are accepted. */
export type PipelineInventoryJob = Pick<CronJob, "id" | "name" | "enabled" | "agentId"> & {
  schedule?: CronJob["schedule"];
  scheduleKind?: CronJob["schedule"]["kind"];
  state?: Pick<CronJob["state"], "lastRunStatus" | "lastStatus">;
  lastRunStatus?: CronJob["state"]["lastRunStatus"] | null;
};
export const PIPELINE_SOURCE = "JohnRiceML/clawport-ui@40db84d69b793048a9f738db57fe6e5db9751df3";

/** Compose only caller-visible inventory; missing names never establish global absence. */
export function projectCronPipelines(pipelines: Pipeline[], jobs: readonly PipelineInventoryJob[]) {
  const byName = new Map<string, PipelineInventoryJob[]>();
  for (const job of jobs) {
    const entries = byName.get(job.name) ?? [];
    entries.push(job);
    byName.set(job.name, entries);
  }
  const references = [...getAllPipelineJobNames(pipelines)].map((name) => {
    const matches = byName.get(name) ?? [];
    return {
      name, resolution: matches.length === 1 ? "visible" : matches.length ? "ambiguous" : "unresolved",
      visibleJobIds: matches.map((job) => job.id),
      ...computePipelineContext(name, pipelines),
    };
  });
  const layoutJobs: PipelineLayoutJob[] = [];
  for (const reference of references) {
    const job = byName.get(reference.name)?.length === 1 ? byName.get(reference.name)?.[0] : undefined;
    layoutJobs.push({ name: reference.name,
      status: !job ? "unknown" : !job.enabled ? "disabled" : job.state?.lastRunStatus ?? job.state?.lastStatus ?? job.lastRunStatus ?? "unknown",
      scheduleDescription: job?.schedule ? describeScheduleForDisplay(job.schedule) ?? job.schedule.kind : job?.scheduleKind ?? "unknown",
      agentId: job?.agentId,
    });
  }
  const graph = buildPipelineLayout(layoutJobs, pipelines, new Map());
  return { source: PIPELINE_SOURCE, scope: "caller-visible Gateway inventory; unresolved references do not establish global absence",
    references, graph };
}
