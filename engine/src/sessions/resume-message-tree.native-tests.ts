import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildTopicMessageFlowGraph } from "./resume-message-tree.js";
import type { TopicMessageFlowGraph, TreeNode, TreeResponse } from "./resume-tree-types.js";

type GoldenCase = { id: string; source: string; input: unknown[]; output: unknown };

const SUBSET_URL = new URL("./resume-message-tree.golden.subset.json", import.meta.url);
const goldenCases = JSON.parse(readFileSync(SUBSET_URL, "utf8")) as GoldenCase[];

function isUndefinedMarker(value: object): boolean {
  const keys = Object.keys(value);
  return keys.length === 1 && keys[0] === "$undef" && (value as Record<string, unknown>)["$undef"] === true;
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value === null || typeof value !== "object") return value;
  if (isUndefinedMarker(value)) return undefined;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, decodeValue(inner)]));
}

for (const golden of goldenCases) {
  test(`golden ${golden.id} (${golden.source})`, () => {
    const tree = decodeValue(golden.input[0]) as TreeResponse;
    const expected = decodeValue(golden.output) as TopicMessageFlowGraph;
    assert.deepStrictEqual(buildTopicMessageFlowGraph(tree), expected);
  });
}

function baseFields(id: string): Omit<TreeNode, "parentId"> {
  return {
    id,
    role: "user",
    preview: `p-${id}`,
    modelId: null,
    status: "success",
    createdAt: "2026-01-01T00:00:00Z",
    hasChildren: false,
  };
}

function node(id: string, parentId: string | null | undefined, extra: Partial<TreeNode> = {}): TreeNode {
  return { ...baseFields(id), parentId, ...extra };
}

function member(id: string, extra: Partial<Omit<TreeNode, "parentId">> = {}): Omit<TreeNode, "parentId"> {
  return { ...baseFields(id), ...extra };
}

function tree(
  nodes: TreeNode[],
  activeNodeId: string | null = null,
  siblingsGroups: TreeResponse["siblingsGroups"] = [],
): TreeResponse {
  return { nodes, siblingsGroups, activeNodeId, rootId: null };
}

test("empty tree gives an empty graph and echoes the active id", () => {
  assert.deepStrictEqual(buildTopicMessageFlowGraph(tree([], "zzz")), {
    nodes: [],
    edges: [],
    activeNodeId: "zzz",
    stats: { nodeCount: 0, branchCount: 0, activePathLength: 0 },
  });
});

test("single active node is on the active path and has no edges", () => {
  const graph = buildTopicMessageFlowGraph(tree([node("a", null)], "a"));
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0]?.data.isActive, true);
  assert.equal(graph.nodes[0]?.data.isOnActivePath, true);
  assert.deepStrictEqual(graph.edges, []);
  assert.equal(graph.stats.activePathLength, 1);
});

test("chain ends on the active leaf with every node on the path and no branches", () => {
  const graph = buildTopicMessageFlowGraph(tree([node("a", null), node("b", "a"), node("c", "b")], "c"));
  assert.deepStrictEqual(graph.nodes.map((n) => n.data.isOnActivePath), [true, true, true]);
  assert.deepStrictEqual(graph.edges.map((e) => e.data.isInactiveBranch), [false, false]);
  assert.equal(graph.stats.branchCount, 0);
  assert.equal(graph.stats.activePathLength, 3);
});

test("active id absent from the graph marks nothing active, on path, or inactive", () => {
  const graph = buildTopicMessageFlowGraph(tree([node("a", null), node("b", "a")], "zz"));
  for (const n of graph.nodes) {
    assert.equal(n.data.isActive, false);
    assert.equal(n.data.isOnActivePath, false);
    assert.equal(n.data.isInactiveBranch, false);
  }
  assert.equal(graph.activeNodeId, "zz");
  assert.equal(graph.stats.activePathLength, 0);
});

test("orphan keeps its dangling parent id and gets no edge", () => {
  const graph = buildTopicMessageFlowGraph(tree([node("a", null), node("b", "missing")], "b"));
  assert.equal(graph.nodes.find((n) => n.id === "b")?.parentId, "missing");
  assert.deepStrictEqual(graph.edges, []);
  assert.equal(graph.stats.activePathLength, 1);
});

test("undefined parentId is output as null", () => {
  const graph = buildTopicMessageFlowGraph(tree([node("a", undefined)], "a"));
  assert.equal(graph.nodes[0]?.parentId, null);
});

test("sibling group parentId overrides the parent of a node also listed at top level", () => {
  const graph = buildTopicMessageFlowGraph(
    tree([node("a", null), node("b", "a"), node("c", null)], "b", [
      { parentId: "a", siblingsGroupId: 1, nodes: [member("c")] },
    ]),
  );
  assert.equal(graph.nodes.find((n) => n.id === "c")?.parentId, "a");
  assert.ok(graph.edges.some((e) => e.id === "edge:a:c"));
});

test("group members missing from nodes are appended after top-level nodes", () => {
  const graph = buildTopicMessageFlowGraph(
    tree([node("a", null)], "a", [{ parentId: "a", siblingsGroupId: 1, nodes: [member("b"), member("c")] }]),
  );
  assert.deepStrictEqual(graph.nodes.map((n) => [n.id, n.parentId]), [["a", null], ["b", "a"], ["c", "a"]]);
});

test("duplicate ids collapse to one node with the last occurrence winning the parent", () => {
  const graph = buildTopicMessageFlowGraph(tree([node("a", null), node("a", "a"), node("b", "a")], "b"));
  assert.deepStrictEqual(graph.nodes.map((n) => [n.id, n.parentId]), [["a", "a"], ["b", "a"]]);
  assert.deepStrictEqual(graph.edges.map((e) => e.id), ["edge:a:a", "edge:a:b"]);
});

test("parent cycle terminates, keeps both edges, and walks the active path once", () => {
  const graph = buildTopicMessageFlowGraph(tree([node("a", "b"), node("b", "a")], "a"));
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.stats.activePathLength, 2);
});

test("self-parent produces a self-loop edge", () => {
  const graph = buildTopicMessageFlowGraph(tree([node("a", "a")], "a"));
  assert.deepStrictEqual(graph.edges.map((e) => [e.id, e.source, e.target]), [["edge:a:a", "a", "a"]]);
});

test("context and awaiting flags pass through only when present on the input", () => {
  const graph = buildTopicMessageFlowGraph(
    tree([node("a", null, { isContextBoundary: true, isAwaitingInput: false }), node("b", "a")], "b"),
  );
  assert.equal(graph.nodes[0]?.data.isContextBoundary, true);
  assert.equal(graph.nodes[0]?.data.isAwaitingInput, false);
  assert.equal(graph.nodes[1]?.data.isContextBoundary, undefined);
  assert.equal("isAwaitingInput" in (graph.nodes[1]?.data ?? {}), false);
});

test("siblingsGroupId is never emitted", () => {
  const graph = buildTopicMessageFlowGraph(
    tree([node("a", null)], "a", [{ parentId: "a", siblingsGroupId: 7, nodes: [member("b")] }]),
  );
  assert.equal(JSON.stringify(graph).includes("siblingsGroupId"), false);
});

test("branchCount counts the leaves when there are at least two", () => {
  const graph = buildTopicMessageFlowGraph(
    tree([node("a", null), node("b", "a"), node("c", "a"), node("d", "a")], "b"),
  );
  assert.equal(graph.stats.branchCount, 3);
});

test("two top-level nodes count as two branches", () => {
  const graph = buildTopicMessageFlowGraph(tree([node("a", null), node("b", null)], "a"));
  assert.equal(graph.stats.branchCount, 2);
});

test("branchCount separates leaves from sibling pairs: three roots with two children under one gives 4", () => {
  const graph = buildTopicMessageFlowGraph(
    tree([node("a", null), node("b", null), node("c", null), node("d", "a"), node("e", "a")], "a"),
  );
  assert.equal(graph.stats.branchCount, 4);
});

test("assistant reply is a sibling branch only when another assistant reply shares its parent", () => {
  const graph = buildTopicMessageFlowGraph(
    tree([node("a", null), node("b", "a", { role: "assistant" }), node("c", "a", { role: "assistant" }), node("d", "a", { role: "user" })], "b"),
  );
  const flags = Object.fromEntries(graph.edges.map((e) => [e.target, e.data.isSiblingBranch]));
  assert.deepStrictEqual(flags, { b: true, c: true, d: false });
});
