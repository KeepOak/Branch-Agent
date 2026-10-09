import type { Block } from "./model";

/** Steps the engine runs for its own check-ins (`heartbeat_respond` and kin). They stay in the model, never in the transcript. */
export function isInternalStep(block: Block): boolean {
  if (block.kind !== "step") return false;
  const name = block.tool.split(/__|\./).filter(Boolean).pop() ?? "";
  return /^heartbeat(?:[_-]|$)/i.test(name);
}
