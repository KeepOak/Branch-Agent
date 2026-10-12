/** Native structural interfaces for CherryHQ/cherry-studio topicMessageFlowGraph. */
export type TreeNode = {
  id: string;
  parentId?: string | null;
  role: string;
  preview: string;
  modelId: string | null;
  status: string;
  createdAt: string;
  hasChildren: boolean;
  isContextBoundary?: boolean;
  isAwaitingInput?: boolean;
};
export type TreeResponse = {
  nodes: TreeNode[];
  siblingsGroups: { parentId: string | null; siblingsGroupId: number; nodes: Omit<TreeNode, "parentId">[] }[];
  activeNodeId: string | null;
  rootId: string | null;
};
export type TopicMessageFlowNodeData = Omit<TreeNode, "id" | "parentId" | "hasChildren"> & {
  messageId: string;
  isActive: boolean;
  isOnActivePath: boolean;
  isInactiveBranch: boolean;
  siblingsGroupId?: number;
};
export type TopicMessageFlowGraph = {
  nodes: { id: string; parentId: string | null; data: TopicMessageFlowNodeData }[];
  edges: { id: string; source: string; target: string;
    data: { isActivePath: boolean; isSiblingBranch: boolean; isInactiveBranch: boolean } }[];
  activeNodeId: string | null;
  stats: { nodeCount: number; branchCount: number; activePathLength: number };
};
