/*
MIT License

Copyright (c) 2025 John Rice

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
// Selected source context/layout functions; no React dependency or workflow execution.
import type { Pipeline } from "./pipeline-definitions.js";
export type PipelineLayoutJob = {
  name: string; scheduleDescription?: string | null; status: string;
  agentId?: string | null; delivery?: { to?: string | null } | null;
};
export interface PipelineInput {
  pipeline: string
  from: string
  artifact: string
}

export interface PipelineOutput {
  pipeline: string
  to: string
  artifact: string
}

/**
 * Compute the pipeline inputs and outputs for a given job name.
 */
export function computePipelineContext(
  jobName: string,
  pipelines: Pipeline[],
): { inputs: PipelineInput[]; outputs: PipelineOutput[] } {
  const inputs: PipelineInput[] = []
  const outputs: PipelineOutput[] = []

  for (const p of pipelines) {
    for (const e of p.edges) {
      if (e.to === jobName) {
        inputs.push({ pipeline: p.name, from: e.from, artifact: e.artifact })
      }
      if (e.from === jobName) {
        outputs.push({ pipeline: p.name, to: e.to, artifact: e.artifact })
      }
    }
  }

  return { inputs, outputs }
}

export interface LayoutNode {
  id: string
  type: string
  data: Record<string, unknown>
  position: { x: number; y: number }
  selectable?: boolean
  draggable?: boolean
  style?: Record<string, unknown>
}

export interface LayoutEdge {
  id: string
  source: string
  target: string
  type: string
  label: string
  labelStyle: Record<string, unknown>
  style: Record<string, unknown>
  animated: boolean
}

/**
 * Build the topological layout of pipeline nodes and edges for React Flow.
 */
export function buildPipelineLayout(
  crons: PipelineLayoutJob[],
  pipelines: Pipeline[],
  agentColorMap: Map<string, string>,
  selectedJob?: string | null,
): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const cronMap = new Map(crons.map(c => [c.name, c]))
  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []

  let groupY = 0

  for (const pipeline of pipelines) {
    // Group label node
    nodes.push({
      id: JSON.stringify([pipeline.name, null]),
      type: "default",
      data: { label: pipeline.name },
      position: { x: 0, y: groupY },
      selectable: false,
      draggable: false,
      style: {
        background: "transparent",
        border: "none",
        fontSize: 13,
        fontWeight: 700,
        color: "var(--text-secondary)",
        padding: 0,
        width: 200,
      },
    })

    groupY += 36

    // Determine node positions using topological ordering
    const jobNames: string[] = []
    for (const edge of pipeline.edges) {
      if (!jobNames.includes(edge.from)) jobNames.push(edge.from)
      if (!jobNames.includes(edge.to)) jobNames.push(edge.to)
    }

    // Assign columns by dependency depth
    const depth = new Map<string, number>()
    for (const name of jobNames) depth.set(name, 0)
    for (let pass = 0; pass < jobNames.length; pass++) {
      for (const edge of pipeline.edges) {
        const fromD = depth.get(edge.from) || 0
        const toD = depth.get(edge.to) || 0
        if (fromD + 1 > toD) depth.set(edge.to, fromD + 1)
      }
    }

    // Group by depth for vertical stacking
    const byDepth = new Map<number, string[]>()
    for (const [name, d] of depth) {
      const arr = byDepth.get(d) || []
      arr.push(name)
      byDepth.set(d, arr)
    }

    const maxDepth = Math.max(...Array.from(byDepth.keys()), 0)
    const colSpacing = 280
    const rowSpacing = 80

    for (let d = 0; d <= maxDepth; d++) {
      const namesAtDepth = byDepth.get(d) || []
      namesAtDepth.forEach((name, i) => {
        const cron = cronMap.get(name)
        const nodeId = JSON.stringify([pipeline.name, name])

        nodes.push({
          id: nodeId,
          type: "cronPipelineNode",
          data: {
            name,
            schedule: cron?.scheduleDescription || "\u2014",
            status: cron?.status || "idle",
            deliveryTo: cron?.delivery?.to || null,
            color: agentColorMap.get(cron?.agentId || "") || "var(--text-secondary)",
            selected: selectedJob === name,
          } as Record<string, unknown>,
          position: { x: d * colSpacing + 20, y: groupY + i * rowSpacing },
        })
      })
    }

    // Edges
    for (let ei = 0; ei < pipeline.edges.length; ei++) {
      const pEdge = pipeline.edges[ei]
      if (!pEdge) continue
      const sourceId = JSON.stringify([pipeline.name, pEdge.from])
      const targetId = JSON.stringify([pipeline.name, pEdge.to])
      const sourceCron = cronMap.get(pEdge.from)
      const isErrored = sourceCron?.status === "error"

      edges.push({
        id: `${sourceId}->${targetId}::${ei}`,
        source: sourceId,
        target: targetId,
        type: "smoothstep",
        label: pEdge.artifact,
        labelStyle: { fontSize: 9, fill: "var(--text-muted)" },
        style: {
          stroke: isErrored ? "#ef4444" : "var(--accent, #6366f1)",
          strokeWidth: 1.5,
          strokeDasharray: isErrored ? "6 4" : undefined,
          opacity: isErrored ? 0.7 : 1,
        },
        animated: !isErrored,
      })
    }

    // Advance Y for next group
    const maxNodesPerCol = Math.max(
      ...Array.from(byDepth.values()).map(arr => arr.length),
      1
    )
    groupY += maxNodesPerCol * rowSpacing + 40
  }

  return { nodes, edges }
}
