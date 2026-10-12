// Ported from RooCodeInc/Roo-Code@b867ec9145750d0ae1ff7f02d35406e9bf2a0b16
// src/core/webview/aggregateTaskCosts.ts. The callback supplies scoped own costs
// and direct child identities; it must not supply already-aggregated costs.
export interface SubagentCostHistory {
  totalCost?: number | null;
  childIds?: readonly string[];
}

export interface AggregatedCosts {
	ownCost: number // This task's own API costs
	childrenCost: number // Sum of all direct children costs (recursive)
	totalCost: number // ownCost + childrenCost
	childBreakdown?: {
		// Optional detailed breakdown
		[childId: string]: AggregatedCosts
	}
}

/**
 * Recursively aggregate costs for a task and all its subtasks.
 *
 * @param taskId - The task ID to aggregate costs for
 * @param getTaskHistory - Function to load own-cost history by task ID
 * @param visited - Set to prevent circular references
 * @returns Aggregated cost information
 */
export async function aggregateTaskCostsRecursive(
	taskId: string,
	getTaskHistory: (id: string) => Promise<SubagentCostHistory | undefined>,
	visited: Set<string> = new Set(),
): Promise<AggregatedCosts> {
	// Prevent infinite loops
	if (visited.has(taskId)) {
		console.warn(`[aggregateTaskCostsRecursive] Circular reference detected: ${taskId}`)
		return { ownCost: 0, childrenCost: 0, totalCost: 0 }
	}
	visited.add(taskId)

	// Load this task's history
	const history = await getTaskHistory(taskId)
	if (!history) {
		console.warn(`[aggregateTaskCostsRecursive] Task ${taskId} not found`)
		return { ownCost: 0, childrenCost: 0, totalCost: 0 }
	}

	const ownCost = history.totalCost || 0
	let childrenCost = 0
	const childBreakdown: { [childId: string]: AggregatedCosts } = {}

	// Recursively aggregate child costs
	if (history.childIds && history.childIds.length > 0) {
		for (const childId of history.childIds) {
			const childAggregated = await aggregateTaskCostsRecursive(
				childId,
				getTaskHistory,
				new Set(visited), // Create new Set to allow sibling traversal
			)
			childrenCost += childAggregated.totalCost
			childBreakdown[childId] = childAggregated
		}
	}

	const result: AggregatedCosts = {
		ownCost,
		childrenCost,
		totalCost: ownCost + childrenCost,
		childBreakdown,
	}

	return result
}
