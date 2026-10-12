// Atlas AUTOMATION-0004: source scheduler acceptance through real Gateway RPC.
// OpenClaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3 src/cron/stagger.ts.
import assert from "node:assert/strict";
import type { GatewayClient } from "../src/gateway/client.js";
import { computeJobNextRunAtMs } from "../src/cron/service/jobs-scheduling.js";
import type { CronJob } from "../src/cron/types.js";

export async function acceptCronStagger(client: GatewayClient): Promise<string[]> {
  const create = async (name: string, staggerMs?: number) => {
    const response = await client.request<CronJob | { job: CronJob }>("cron.add", {
      name,
      enabled: false,
      agentId: "main",
      schedule: { kind: "cron", expr: "0 * * * *", tz: "UTC", ...(staggerMs === undefined ? {} : { staggerMs }) },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: { kind: "agentTurn", message: "Isolated schedule acceptance; never execute" },
      delivery: { mode: "none" },
    });
    return "job" in response ? response.job : response;
  };
  const jobs: [CronJob, CronJob, CronJob, CronJob] = [await create("Default spread A"), await create("Default spread B"), await create("Exact opt-out", 0), await create("Explicit spread", 9_000)];
  assert.deepEqual(jobs.map(job => { assert(job.schedule.kind === "cron"); return job.schedule.staggerMs; }), [300_000, 300_000, 0, 9_000]);
  const hour = Date.parse("2027-01-01T10:00:00Z");
  // Only calculate with enabled copies. Persisted jobs remain disabled and cron is off.
  const next = jobs.map(job => computeJobNextRunAtMs({ ...job, enabled: true }, hour - 1));
  for (const index of [0, 1] as const) {
    assert(next[index] !== undefined && next[index]! >= hour && next[index]! < hour + 300_000);
    assert.equal(computeJobNextRunAtMs({ ...jobs[index], enabled: true }, hour - 1), next[index]);
  }
  assert.equal(next[2], hour);
  assert(next[3] !== undefined && next[3] >= hour && next[3] < hour + 9_000);
  assert(jobs.every(job => job.enabled === false));
  console.log("PASS: AUTOMATION-0004 real RPC defaults/custom spread/exact opt-out, stable bounded source scheduler offsets; all persisted jobs disabled");
  return jobs.map(job => job.id);
}

export async function verifyCronStaggerPersistence(client: GatewayClient, ids: string[]) {
  const page = await client.request<{ jobs: CronJob[] }>("cron.list", { includeDisabled: true });
  for (const [index, id] of ids.entries()) {
    const job = page.jobs.find(candidate => candidate.id === id);
    assert(job, "Persisted schedule missing after Gateway restart");
    assert.equal(job.enabled, false);
    assert(job.schedule.kind === "cron");
    assert.equal(job.schedule.staggerMs, [300_000, 300_000, 0, 9_000][index]);
  }
  console.log("PASS: AUTOMATION-0004 persisted defaults/custom spread/exact opt-out survive real Gateway restart");
}
