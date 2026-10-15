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
  siblingsGroups: {
    parentId: string | null;
    siblingsGroupId: number;
    nodes: Omit<TreeNode, "parentId">[];
  }[];
  activeNodeId: string | null;
  rootId: string | null;
};

export type TopicMessageFlowGraph = {
  nodes: {
    id: string;
    parentId: string | null;
    data: {
      messageId: string;
      role: string;
      status: string;
      preview: string;
      modelId: string | null;
      createdAt: string;
      isActive: boolean;
      isOnActivePath: boolean;
      isInactiveBranch: boolean;
      isContextBoundary?: boolean;
      isAwaitingInput?: boolean;
    };
  }[];
  edges: {
    id: string;
    source: string;
    target: string;
    data: {
      isActivePath: boolean;
      isSiblingBranch: boolean;
      isInactiveBranch: boolean;
    };
  }[];
  activeNodeId: string | null;
  stats: {
    nodeCount: number;
    branchCount: number;
    activePathLength: number;
  };
};
