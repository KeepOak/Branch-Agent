// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:openhands-sdk/openhands/sdk/context/view/properties/batch_atomicity.py (atlas AGENT-LOOP-0093). Converted to TypeScript.
import { complete, subset, type ViewProperty, type ViewEvent } from "./view-types.js";
function buildBatches(events: ViewEvent[]): Map<string | undefined, Set<string>> {
  const batches = new Map<string | undefined, Set<string>>();
  for (const e of events) if (e.kind === "action") {
    const ids = batches.get(e.llmResponseId) ?? new Set<string>(); ids.add(e.id); batches.set(e.llmResponseId, ids);
  }
  return batches;
}
export class BatchAtomicityProperty implements ViewProperty {
  enforce(view: ViewEvent[], all: ViewEvent[]): Set<string> {
    const batches = buildBatches(all); const removed = new Set<string>();
    for (const [key, ids] of buildBatches(view)) {
      const original = batches.get(key) ?? new Set<string>();
      if (ids.size !== original.size || !subset(ids, original)) for (const id of ids) removed.add(id);
    }
    return removed;
  }
  manipulationIndices(view: ViewEvent[]): Set<number> {
    const indices = complete(view);
    for (let i = 1; i < view.length; i++) {
      // The loop bounds guarantee both adjacent events exist.
      const previous = view[i - 1]!;
      const current = view[i]!;
      if (previous.kind === "action" && current.kind === "action" && previous.llmResponseId === current.llmResponseId) indices.delete(i);
    }
    return indices;
  }
}
