import type { Block } from "./model";

export type NativeHelper = {
  key: string;
  name: string;
  task?: string;
  status: "running" | "done" | "interrupted" | "unknown";
  at?: number;
};

const rec = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const str = (v: unknown) => typeof v === "string" ? v : "";
function input(text?: string): Record<string, unknown> {
  try {
    const value = rec(JSON.parse(text ?? ""));
    return typeof value.arguments === "string" ? rec(JSON.parse(value.arguments)) : value;
  } catch { return {}; }
}

/** Native workers have no sidebar session. Read only their recorded parent-thread evidence.
 * A successful spawn/follow-up call is not proof that the worker finished its assignment. */
export function nativeHelpers(blocks: readonly Block[]): NativeHelper[] {
  const helpers = new Map<string, NativeHelper>();
  const steps = new Map<string, Extract<Block, { kind: "step" }>>();
  const time = (b: Extract<Block, { kind: "step" }>) => b.at && Number.isFinite(b.at) && b.at > 0 ? b.at : 0;
  for (const block of blocks) {
    if (block.kind !== "step") continue;
    const previous = steps.get(block.key);
    if (!previous) { steps.set(block.key, block); continue; }
    const newer = time(block) >= time(previous) ? block : previous;
    const older = newer === block ? previous : block;
    // A checkpoint owns the arguments; a newer argument-free item owns the observation.
    // They are two views of the same call, not mutually exclusive snapshots.
    const operation = [newer.originalTool, newer.tool, older.originalTool, older.tool].find((tool) => ["spawn_agent", "followup_task"].includes(tool?.split(".").at(-1) ?? ""));
    steps.set(block.key, { ...newer, input: newer.input ?? older.input, originalTool: operation ?? newer.originalTool });
  }
  // History checkpoints overlap the live buffer; neither array position nor parent completion
  // establishes the worker's latest assignment. Preserve the recorded observation order.
  for (const block of [...steps.values()].sort((a, b) => time(a) - time(b))) {
    const tool = (block.originalTool ?? block.tool).split(".").at(-1);
    const args = input(block.input);
    const spawn = tool === "spawn_agent";
    const observation = block.tool.split(".").at(-1) === "subagents" ? /^(started|completed|interrupted): (\/root\/\S+)$/.exec(block.title) : null;
    if (spawn && ((block.status !== "failed" && block.status !== "denied") || observation)) {
      const name = str(args.task_name);
      const task = str(args.message);
      if (!name && !task) continue;
      const path = name ? `/root/${name}` : block.key;
      helpers.set(path, { key: path, name: name || "Helper", task: task || undefined, status: "unknown", at: time(block) || undefined });
    } else if (tool === "followup_task" && block.status !== "failed" && block.status !== "denied") {
      const target = str(args.target);
      const helper = helpers.get(target) ?? helpers.get(`/root/${target}`);
      if (helper) { helper.task = str(args.message) || helper.task; helper.status = "unknown"; helper.at = time(block) || undefined; }
    }
    if (block.tool.split(".").at(-1) === "subagents") {
      // Codex subAgentActivity observations, not the completion of a spawn/wait tool.
      const match = observation;
      if (!match) continue;
      const path = match[2]!;
      const helper = helpers.get(path) ?? { key: path, name: path.slice("/root/".length), status: "unknown" as const };
      helper.status = match[1] === "started" ? "running" : match[1] === "completed" ? "done" : "interrupted";
      helper.at = time(block) || undefined;
      helpers.set(path, helper);
    }
  }
  return [...helpers.values()];
}
