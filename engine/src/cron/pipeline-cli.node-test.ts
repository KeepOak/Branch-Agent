import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { registerCronPipelinesCommand } from "../cli/cron-cli/register.cron-pipelines.js";
import { readPipelineDefinitions } from "./pipeline-definitions.js";
import { isCommandJsonOutputMode } from "../cli/program/json-mode.js";
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "branch-pipeline-native-"));
after(() => {
  assert.equal(path.dirname(path.resolve(temporaryRoot)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(temporaryRoot).startsWith("branch-pipeline-native-"));
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
});
const declarations = [{ name: "daily", edges: [{ from: "collect", to: "report", artifact: "data.json" }] }];
const file = path.join(temporaryRoot, "pipelines.json");
fs.writeFileSync(file, JSON.stringify(declarations));
const compactJob = { id: "visible", name: "collect", enabled: true, lastRunStatus: "error" as const, scheduleKind: "every" as const, schedule: { kind: "every" as const, everyMs: 60_000 } };
async function execute(args: string[], options: { env?: NodeJS.ProcessEnv; fail?: boolean } = {}) {
  const output: string[] = [];
  const calls: unknown[] = [];
  const parent = new Command("cron").exitOverride();
  const command = registerCronPipelinesCommand(parent, { log: (value: unknown) => output.push(String(value)) }, {
    env: options.env ?? {},
    listJobs: async (opts, filters) => {
      calls.push({ opts, filters });
      if (options.fail) throw new Error("inventory unavailable");
      return { jobs: [compactJob] };
    },
  });
  await parent.parseAsync(["pipelines", ...args], { from: "user" });
  return { output, calls, command };
}
test("actual Commander command composes source file and scoped inventory into graph JSON", async () => {
  const initial = fs.readFileSync(file, "utf8");
  const result = await execute(["--file", file, "--json", "--port", "19999"]);
  const document = JSON.parse(result.output[0]!);
  assert.equal(document.definitionFile, file);
  assert.equal(document.graph.nodes.length, 3);
  assert.equal(document.graph.edges[0].animated, false);
  assert.deepEqual(document.references.map((reference: { resolution: string }) => reference.resolution), ["visible", "unresolved"]);
  assert.equal(result.calls.length, 1);
  assert.deepEqual((result.calls[0] as { filters: unknown }).filters, { includeDisabled: true });
  assert.equal((result.calls[0] as { opts: { port: string } }).opts.port, "19999");
  assert.match(document.source, /40db84d69/);
  assert.equal(fs.readFileSync(file, "utf8"), initial);
});
test("source default uses WORKSPACE_PATH/clawport/pipelines.json", async () => {
  const workspace = path.join(temporaryRoot, "workspace");
  fs.mkdirSync(path.join(workspace, "clawport"), { recursive: true });
  const defaultFile = path.join(workspace, "clawport", "pipelines.json");
  fs.writeFileSync(defaultFile, JSON.stringify(declarations));
  const result = await execute(["--json"], { env: { WORKSPACE_PATH: workspace } });
  assert.equal(JSON.parse(result.output[0]!).definitionFile, defaultFile);
  assert.equal(result.calls.length, 1);
});
test("unconfigured or absent default source file causes no Gateway operation", async () => {
  for (const env of [{}, { WORKSPACE_PATH: path.join(temporaryRoot, "absent") }]) {
    const result = await execute(["--json"], { env });
    assert.equal(result.calls.length, 0);
    assert.deepEqual(JSON.parse(result.output[0]!).graph.nodes, []);
  }
});
test("explicit missing file, broken JSON and invalid definitions fail rather than emit success", async () => {
  const broken = path.join(temporaryRoot, "broken.json");
  const malformed = path.join(temporaryRoot, "malformed.json");
  fs.writeFileSync(broken, "{"); fs.writeFileSync(malformed, "{}");
  for (const filename of [path.join(temporaryRoot, "missing.json"), broken, malformed]) await assert.rejects(() => execute(["--file", filename, "--json"]), /Cannot read pipeline definitions/);
});
test("implicit malformed source config is an error rather than false unconfigured status", () => {
  const workspace = path.join(temporaryRoot, "invalid-default");
  fs.mkdirSync(path.join(workspace, "clawport"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "clawport", "pipelines.json"), "null");
  assert.throws(() => readPipelineDefinitions(undefined, { WORKSPACE_PATH: workspace }), /Cannot read pipeline definitions/);
});
test("inventory failure propagates with no graph success", async () => {
  await assert.rejects(() => execute(["--file", file, "--json"], { fail: true }), /inventory unavailable/);
});
test("human output retains source artifacts and states the caller-scoped resolution", async () => {
  const result = await execute(["--file", file]);
  assert.match(result.output[0]!, /collect --\[data.json\]--> report/);
  assert.match(result.output[0]!, /report \(unresolved\)/);
  assert.match(result.output[0]!, /do not establish global absence/);
});
test("existing CLI machine-output metadata is registered", async () => {
  const result = await execute(["--json"]);
  assert.equal(isCommandJsonOutputMode(result.command, ["node", "branch", "cron", "pipelines", "--json"]), true);
});
