import type { Block } from "./model";

/** The engine's check-in step, `heartbeat_respond`, bare or namespaced. It stays in the model, never in the transcript. */
export function isInternalStep(block: Block): boolean {
  if (block.kind !== "step") return false;
  const name = block.tool.split(/__|\./).filter(Boolean).pop() ?? "";
  return name === "heartbeat_respond";
}
