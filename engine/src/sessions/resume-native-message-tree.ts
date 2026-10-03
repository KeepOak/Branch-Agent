import { buildTopicMessageFlowGraph } from "./resume-message-tree.js";
import type { TreeNode } from "./resume-tree-types.js";
import { nativeTranscriptEntries } from "./resume-transcript-entries.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
function renderedNode(event: Record<string, unknown>): TreeNode | undefined {
  if (typeof event.id !== "string") return undefined;
  const message = record(event.message);
  if (message?.display === false) return undefined;
  const boundary = event.type === "compaction";
  const entries = nativeTranscriptEntries([event], { includeTimestamps: false, includeToolDetails: false });
  const visible = entries.filter((entry) => entry.kind === "message");
  if (!boundary && !visible.length) return undefined;
  return { id: event.id, parentId: typeof event.parentId === "string" ? event.parentId : null,
    role: boundary ? "system" : String(message?.role),
    preview: boundary ? String(event.summary ?? "Context boundary")
      : visible.map((entry) => entry.kind === "message" ? entry.content : "").join("\n"),
    modelId: typeof message?.model === "string" ? message.model : null,
    status: message?.stopReason === "error" ? "error" : "success",
    createdAt: typeof event.timestamp === "string" ? event.timestamp : "", hasChildren: false,
    ...(boundary ? { isContextBoundary: true } : {}) };
}
function nearestRendered(id: string | null, nodes: Map<string, TreeNode>,
  events: Map<string, Record<string, unknown>>): string | null {
  const visited = new Set<string>();
  while (id && !visited.has(id)) {
    if (nodes.has(id)) return id;
    visited.add(id);
    const parent = events.get(id)?.parentId;
    id = typeof parent === "string" ? parent : null;
  }
  return null;
}

/** The caller supplies raw events and native leaf from one read-only transaction. */
export function nativeMessageTree(events: readonly unknown[], activeLeafEntryId: string | null) {
  const eventsById = new Map(events.flatMap((value): [string, Record<string, unknown>][] => {
    const event = record(value);
    return event && typeof event.id === "string" ? [[event.id, event]] : [];
  }));
  const nodes = new Map([...eventsById.values()].flatMap((event): [string, TreeNode][] => {
    const node = renderedNode(event); return node ? [[node.id, node]] : [];
  }));
  for (const node of nodes.values()) node.parentId = nearestRendered(node.parentId ?? null, nodes, eventsById);
  const parents = new Set([...nodes.values()].map((node) => node.parentId));
  for (const node of nodes.values()) node.hasChildren = parents.has(node.id);
  return buildTopicMessageFlowGraph({ nodes: [...nodes.values()], siblingsGroups: [], rootId: null,
    activeNodeId: nearestRendered(activeLeafEntryId, nodes, eventsById) });
}
