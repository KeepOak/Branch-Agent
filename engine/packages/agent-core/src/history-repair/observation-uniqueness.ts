// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:openhands-sdk/openhands/sdk/context/view/properties/observation_uniqueness.py (atlas AGENT-LOOP-0093). Converted to TypeScript.
import { complete, type ViewProperty, type ViewEvent } from "./view-types.js";
export class ObservationUniquenessProperty implements ViewProperty {
  enforce(view: ViewEvent[]): Set<string> {
    const seen = new Set<string | undefined>(); const removed = new Set<string>();
    for (const event of view) if (event.kind === "observation") {
      if (seen.has(event.toolCallId)) removed.add(event.id); else seen.add(event.toolCallId);
    }
    return removed;
  }
  manipulationIndices(view: ViewEvent[]): Set<number> {
    const seen = new Set<string | undefined>();
    for (const event of view) if (event.kind === "observation") {
      if (seen.has(event.toolCallId)) console.warn(`Duplicate observation-like event for tool_call_id=${event.toolCallId}`);
      else seen.add(event.toolCallId);
    }
    return complete(view);
  }
}
