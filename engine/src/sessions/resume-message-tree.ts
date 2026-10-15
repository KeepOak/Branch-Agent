import type { TopicMessageFlowGraph, TreeNode, TreeResponse } from "./resume-tree-types.js";

type FlowNode = TopicMessageFlowGraph["nodes"][number];
type FlowEdge = TopicMessageFlowGraph["edges"][number];
type NodeRecord = Omit<TreeNode, "parentId"> & { parentId: string | null };
type RecordMap = Map<string, NodeRecord>;
type NodeFlags = { isActive: boolean; onPath: boolean; inactive: boolean };

function toRecord(node: Omit<TreeNode, "parentId">, parentId: string | null): NodeRecord {
  return { ...node, parentId };
}

function collectRecords(tree: TreeResponse): RecordMap {
  const records: RecordMap = new Map();
  for (const node of tree.nodes) {
    records.set(node.id, toRecord(node, node.parentId ?? null));
  }
  for (const group of tree.siblingsGroups) {
    for (const member of group.nodes) {
      records.set(member.id, toRecord(member, group.parentId));
    }
  }
  return records;
}

function activePathIds(records: RecordMap, activeId: string | null): Set<string> {
  const path = new Set<string>();
  let cursor: string | null = activeId;
  while (cursor !== null && records.has(cursor) && !path.has(cursor)) {
    path.add(cursor);
    cursor = records.get(cursor)?.parentId ?? null;
  }
  return path;
}

function edgeSourceOf(record: NodeRecord, records: RecordMap): string | null {
  return record.parentId !== null && records.has(record.parentId) ? record.parentId : null;
}

// A leaf is a node that no edge leaves from. A self-parented node is its own source, so it is not a leaf.
function leafCount(records: RecordMap): number {
  const sources = new Set<string>();
  for (const record of records.values()) {
    const source = edgeSourceOf(record, records);
    if (source !== null) sources.add(source);
  }
  let leaves = 0;
  for (const id of records.keys()) {
    if (!sources.has(id)) leaves += 1;
  }
  return leaves;
}

// Leaves count as branches only when there are at least two of them.
function branchCountOf(records: RecordMap): number {
  const leaves = leafCount(records);
  return leaves >= 2 ? leaves : 0;
}

function nodeData(record: NodeRecord, flags: NodeFlags): FlowNode["data"] {
  const data: FlowNode["data"] = {
    messageId: record.id,
    role: record.role,
    isContextBoundary: record.isContextBoundary,
    status: record.status,
    preview: record.preview,
    modelId: record.modelId,
    createdAt: record.createdAt,
    isActive: flags.isActive,
    isOnActivePath: flags.onPath,
    isInactiveBranch: flags.inactive,
  };
  if (record.isAwaitingInput !== undefined) data.isAwaitingInput = record.isAwaitingInput;
  return data;
}

function flagsFor(id: string, activeNodeId: string | null, path: Set<string>, activeInGraph: boolean): NodeFlags {
  const onPath = path.has(id);
  return { isActive: id === activeNodeId, onPath, inactive: activeInGraph && !onPath };
}

// Fitted to the golden corpus, not derived from the spec: an assistant reply is a sibling
// branch when another assistant reply shares its parent. Self-loops are never sibling branches.
function assistantChildren(records: RecordMap): Map<string, string[]> {
  const byParent = new Map<string, string[]>();
  for (const record of records.values()) {
    const source = edgeSourceOf(record, records);
    if (source === null || record.role !== "assistant") continue;
    byParent.set(source, [...(byParent.get(source) ?? []), record.id]);
  }
  return byParent;
}

function isSiblingBranch(record: NodeRecord, sourceId: string, byParent: Map<string, string[]>): boolean {
  if (record.role !== "assistant" || record.id === sourceId) return false;
  return (byParent.get(sourceId) ?? []).some((id) => id !== record.id && id !== sourceId);
}

function edgeFor(record: NodeRecord, sourceId: string, flags: NodeFlags, siblingBranch: boolean): FlowEdge {
  return {
    id: `edge:${sourceId}:${record.id}`,
    source: sourceId,
    target: record.id,
    data: { isActivePath: flags.onPath, isSiblingBranch: siblingBranch, isInactiveBranch: flags.inactive },
  };
}

export function buildTopicMessageFlowGraph(tree: TreeResponse): TopicMessageFlowGraph {
  const records = collectRecords(tree);
  const activeNodeId = tree.activeNodeId;
  const activeInGraph = activeNodeId !== null && records.has(activeNodeId);
  const path = activePathIds(records, activeInGraph ? activeNodeId : null);

  const byParent = assistantChildren(records);
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  for (const record of records.values()) {
    const flags = flagsFor(record.id, activeNodeId, path, activeInGraph);
    nodes.push({ id: record.id, parentId: record.parentId, data: nodeData(record, flags) });
    const source = edgeSourceOf(record, records);
    if (source !== null) edges.push(edgeFor(record, source, flags, isSiblingBranch(record, source, byParent)));
  }

  return {
    nodes,
    edges,
    activeNodeId,
    stats: { nodeCount: nodes.length, branchCount: branchCountOf(records), activePathLength: path.size },
  };
}
