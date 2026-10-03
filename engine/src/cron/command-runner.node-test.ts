import assert from "node:assert/strict";
import { test } from "node:test";
import { runCronCommandJob } from "./command-runner.js";
import type { CronJob } from "./types.js";

function commandJob(script: string): CronJob {
  return { id: "automation-command-proof", name: "command proof", enabled: false,
    createdAtMs: 1, updatedAtMs: 1, schedule: { kind: "every", everyMs: 60000 },
    sessionTarget: "isolated", wakeMode: "now", state: {},
    payload: { kind: "command", argv: [process.execPath, "-e", script], timeoutSeconds: 5 } };
}

test("scheduled command runs a real local process with no model call", async () => {
  const result = await runCronCommandJob({ job: commandJob('process.stdout.write("automation-proof")') });
  assert.equal(result.status, "ok");
  assert.equal(result.summary, "automation-proof");
  assert.equal(result.diagnostics?.entries[0]?.exitCode, 0);
});

test("failed command records its real exit code and output", async () => {
  const result = await runCronCommandJob({ job: commandJob('process.stderr.write("failure-proof"); process.exitCode=7') });
  assert.equal(result.status, "error");
  assert.match(result.error ?? "", /code 7/);
  assert.equal(result.summary, "failure-proof");
  assert.equal(result.diagnostics?.entries[0]?.exitCode, 7);
});
