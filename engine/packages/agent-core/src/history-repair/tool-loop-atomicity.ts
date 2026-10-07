// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:openhands-sdk/openhands/sdk/context/view/properties/tool_loop_atomicity.py (atlas AGENT-LOOP-0093). Converted to TypeScript.
import { complete, subset, type ViewProperty, type ViewEvent } from "./view-types.js";
function toolLoops(events: ViewEvent[]): Set<string>[] {
  const loops: Set<string>[] = []; let current: Set<string> | undefined;
  for (const event of events) {
    if (event.kind === "action" && event.thinking) { if (current) loops.push(current); current = new Set([event.id]); }
    else if (event.kind === "action" || event.kind === "observation") current?.add(event.id);
    else if (current) { loops.push(current); current = undefined; }
  }
  if (current) loops.push(current); return loops;
}
export class ToolLoopAtomicityProperty implements ViewProperty {
  enforce(view: ViewEvent[], all: ViewEvent[]): Set<string> {
    const ids = new Set(view.map(e => e.id)); const removed = new Set<string>();
    for (const loop of toolLoops(all)) if (!subset(loop, ids)) for (const id of loop) if (ids.has(id)) removed.add(id);
    return removed;
  }
  manipulationIndices(view: ViewEvent[]): Set<number> {
    const indices = complete(view); let inLoop = false;
    for (const [index, event] of view.entries()) {
      if (event.kind === "action" && event.thinking) inLoop = true;
      else if (event.kind === "action" || event.kind === "observation") { if (inLoop) indices.delete(index); }
      else inLoop = false;
    }
    return indices;
  }
}
