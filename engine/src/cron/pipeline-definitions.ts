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
/**
 * Pipeline types and client-safe utilities.
 * Server-only loader lives in cron-pipelines.server.ts.
 */

export interface PipelineEdge {
  from: string
  to: string
  artifact: string
}

export interface Pipeline {
  name: string
  edges: PipelineEdge[]
}

/** Get all pipelines that include a specific job name. */
export function getPipelinesForJob(name: string, pipelines: Pipeline[]): Pipeline[] {
  return pipelines.filter(p =>
    p.edges.some(e => e.from === name || e.to === name)
  )
}

/** Get the set of all job names that appear in any pipeline. */
export function getAllPipelineJobNames(pipelines: Pipeline[]): Set<string> {
  const names = new Set<string>()
  for (const p of pipelines) {
    for (const e of p.edges) {
      names.add(e.from)
      names.add(e.to)
    }
  }
  return names
}

import fs from "node:fs";
import path from "node:path";

/** Keep source array/edge shape; reject malformed definitions before rendering them. */
export function parsePipelineDefinitions(value: unknown): Pipeline[] {
  if (!Array.isArray(value)) throw new Error("Pipeline definitions must be an array");
  const names = new Set<string>();
  return value.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid pipeline definition");
    const record = item as Record<string, unknown>;
    if (typeof record.name !== "string" || !record.name.trim() || !Array.isArray(record.edges)) {
      throw new Error("Each pipeline requires a nonempty name and an edges array");
    }
    if (names.has(record.name)) throw new Error(`Duplicate pipeline name: ${record.name}`);
    names.add(record.name);
    const edges = record.edges.map((value: unknown): PipelineEdge => {
      if (!value || typeof value !== "object") throw new Error("Invalid pipeline edge");
      const edge = value as Record<string, unknown>;
      if (typeof edge.from !== "string" || !edge.from.trim() || typeof edge.to !== "string" || !edge.to.trim() || typeof edge.artifact !== "string") {
        throw new Error("Each pipeline edge requires from, to and artifact strings");
      }
      return { from: edge.from, to: edge.to, artifact: edge.artifact };
    });
    return { name: record.name, edges };
  });
}

/** Source default retained: WORKSPACE_PATH/clawport/pipelines.json; missing means unconfigured. */
export function readPipelineDefinitions(filename?: string, env: NodeJS.ProcessEnv = process.env): {
  pipelines: Pipeline[]; path: string | null;
} {
  const selected = filename ?? (env.WORKSPACE_PATH ? path.join(env.WORKSPACE_PATH, "clawport", "pipelines.json") : undefined);
  if (!selected) return { pipelines: [], path: null };
  const resolved = path.resolve(selected);
  try {
    return { pipelines: parsePipelineDefinitions(JSON.parse(fs.readFileSync(resolved, "utf8"))), path: resolved };
  } catch (error) {
    if (!filename && (error as NodeJS.ErrnoException).code === "ENOENT") return { pipelines: [], path: resolved };
    throw new Error(`Cannot read pipeline definitions at ${resolved}`, { cause: error });
  }
}