import assert from "node:assert/strict";
import test from "node:test";
import { getAllPipelineJobNames, getPipelinesForJob, parsePipelineDefinitions } from "./pipeline-definitions.js";
import { buildPipelineLayout, computePipelineContext } from "./pipeline-layout.js";
import { projectCronPipelines } from "./pipeline-projection.js";
import { compactCronListJob } from "../gateway/server-methods/cron-list-projection.js";
import type { CronJob } from "./types.js";

const pipelines = [{ name: "daily", edges: [{ from: "collect", to: "report", artifact: "results.json" }, { from: "report", to: "notify", artifact: "summary.md" }] }];
function job(id: string, name: string): CronJob {
  return { id, name, enabled: true, createdAtMs: 1, updatedAtMs: 1, schedule: { kind: "every", everyMs: 60_000 }, sessionTarget: "isolated", wakeMode: "now", payload: { kind: "agentTurn", message: "test" }, state: { lastRunStatus: "ok" } };
}
test("source job membership and all-reference set preserve declaration order", () => {
  assert.deepEqual(getPipelinesForJob("report", pipelines), pipelines);
  assert.deepEqual(getPipelinesForJob("absent", pipelines), []);
  assert.deepEqual([...getAllPipelineJobNames(pipelines)], ["collect", "report", "notify"]);
});
test("source context reports exact inbound and outbound artifacts across pipelines", () => {
  assert.deepEqual(computePipelineContext("report", pipelines), {
    inputs: [{ pipeline: "daily", from: "collect", artifact: "results.json" }],
    outputs: [{ pipeline: "daily", to: "notify", artifact: "summary.md" }],
  });
  assert.deepEqual(computePipelineContext("absent", pipelines), { inputs: [], outputs: [] });
});
test("source DAG depth and source spacing place dependency chain in ordered columns", () => {
  const { nodes, edges } = buildPipelineLayout([{ name: "collect", status: "ok" }, { name: "report", status: "ok" }, { name: "notify", status: "ok" }], pipelines, new Map());
  assert.deepEqual(nodes.filter((node) => node.type === "cronPipelineNode").map((node) => node.position), [{ x: 20, y: 36 }, { x: 300, y: 36 }, { x: 580, y: 36 }]);
  assert.deepEqual(edges.map((edge) => edge.label), ["results.json", "summary.md"]);
  assert.equal(nodes[0]?.selectable, false);
});
test("source errored producer marks outgoing edge and selected node remains selected", () => {
  const graph = buildPipelineLayout([{ name: "collect", status: "error", agentId: "a" }], pipelines, new Map([["a", "#abc"]]), "collect");
  assert.equal(graph.edges[0]?.animated, false);
  assert.equal(graph.edges[0]?.style.stroke, "#ef4444");
  assert.equal(graph.nodes[1]?.data.selected, true);
  assert.equal(graph.nodes[1]?.data.color, "#abc");
});
test("source bounded layout terminates for cyclic declarations without claiming execution", () => {
  const graph = buildPipelineLayout([], [{ name: "cycle", edges: [{ from: "a", to: "b", artifact: "x" }, { from: "b", to: "a", artifact: "y" }] }], new Map());
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 2);
  assert.ok(graph.nodes.every((node) => Number.isFinite(node.position.x)));
});
test("adapted graph IDs do not collide for source names containing delimiters", () => {
  const definitions = [{ name: "a::b", edges: [{ from: "c", to: "d", artifact: "" }] }, { name: "a", edges: [{ from: "b::c", to: "b::d", artifact: "" }] }];
  const graph = buildPipelineLayout([], definitions, new Map());
  assert.equal(new Set(graph.nodes.map((node) => node.id)).size, graph.nodes.length);
  assert.ok(graph.edges.every((edge) => graph.nodes.some((node) => node.id === edge.source) && graph.nodes.some((node) => node.id === edge.target)));
});
test("missing and duplicate names remain unresolved or ambiguous within visible inventory", () => {
  const result = projectCronPipelines(pipelines, [job("one", "collect"), job("two", "collect"), job("report", "report")]);
  assert.deepEqual(result.references.map((reference) => [reference.name, reference.resolution]), [["collect", "ambiguous"], ["report", "visible"], ["notify", "unresolved"]]);
  assert.deepEqual(result.references[0]?.visibleJobIds, ["one", "two"]);
  assert.match(result.scope, /do not establish global absence/);
  assert.equal(result.graph.nodes.find((node) => node.data.name === "collect")?.data.status, "unknown");
  assert.equal(result.graph.nodes.find((node) => node.data.name === "notify")?.data.status, "unknown");
});
test("actual compact Gateway projection and full rows yield the same graph status/schedule", () => {
  const target = job("collect", "collect");
  const full = projectCronPipelines(pipelines, [target]);
  const compact = projectCronPipelines(pipelines, [compactCronListJob(target)]);
  assert.deepEqual(compact, full);
});
test("disabled real job is explicit, never promoted to an idle or successful run", () => {
  const target = job("collect", "collect");
  target.enabled = false;
  assert.equal(projectCronPipelines(pipelines, [target]).graph.nodes.find((node) => node.data.name === "collect")?.data.status, "disabled");
});
test("empty source declaration set renders no synthetic pipelines or jobs", () => {
  assert.deepEqual(projectCronPipelines([], [job("x", "x")]).graph, { nodes: [], edges: [] });
});
test("definition validation preserves source shape and does not mutate parsed input", () => {
  const input = JSON.parse(JSON.stringify(pipelines));
  assert.deepEqual(parsePipelineDefinitions(input), pipelines);
  assert.deepEqual(input, pipelines);
});
test("malformed or duplicate pipeline definitions fail before inventory access", () => {
  for (const input of [null, {}, [null], [{ name: "x", edges: {} }], [{ name: "x", edges: [{ from: "a", to: "b" }] }], [pipelines[0], pipelines[0]]]) assert.throws(() => parsePipelineDefinitions(input));
});
