// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:openhands-sdk/openhands/sdk/context/view/properties/tool_call_matching.py (atlas AGENT-LOOP-0093). Converted to TypeScript.
import { complete, type ViewProperty, type ViewEvent } from "./view-types.js";
export class ToolCallMatchingProperty implements ViewProperty {
  enforce(view: ViewEvent[]): Set<string> {
    const actions = new Set(view.filter(e => e.kind === "action").map(e => e.toolCallId));
    const observations = new Set(view.filter(e => e.kind === "observation").map(e => e.toolCallId));
    return new Set(view.filter(e => e.kind === "action" ? !observations.has(e.toolCallId) : e.kind === "observation" ? !actions.has(e.toolCallId) : false).map(e => e.id));
  }
  manipulationIndices(view: ViewEvent[]): Set<number> {
    const indices = complete(view); const pending = new Set<string | undefined>();
    for (const [index, event] of view.entries()) {
      if (event.kind === "action") pending.add(event.toolCallId);
      if (event.kind === "observation") pending.delete(event.toolCallId);
      if (pending.size) indices.delete(index + 1);
    }
    return indices;
  }
}
