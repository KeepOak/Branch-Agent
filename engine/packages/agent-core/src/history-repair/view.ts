// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:openhands-sdk/openhands/sdk/context/view/view.py (atlas AGENT-LOOP-0093). Converted to TypeScript preserving condensation order and fixed-point enforcement.
import { complete, type ViewEvent, type ViewProperty } from "./view-types.js";
import { ObservationUniquenessProperty } from "./observation-uniqueness.js";
import { BatchAtomicityProperty } from "./batch-atomicity.js";
import { ToolCallMatchingProperty } from "./tool-call-matching.js";
import { ToolLoopAtomicityProperty } from "./tool-loop-atomicity.js";
export const ALL_PROPERTIES: ViewProperty[] = [new ObservationUniquenessProperty(), new BatchAtomicityProperty(), new ToolCallMatchingProperty(), new ToolLoopAtomicityProperty()];
export class View {
  unhandledCondensationRequest = false;
  constructor(public events: ViewEvent[] = []) {}
  get manipulationIndices(): Set<number> {
    let indices = complete(this.events);
    for (const property of ALL_PROPERTIES) { const allowed = property.manipulationIndices(this.events); indices = new Set([...indices].filter(i => allowed.has(i))); }
    return indices;
  }
  enforceProperties(all: ViewEvent[]): void {
    while (true) {
      let changed = false;
      for (const property of ALL_PROPERTIES) {
        const removed = property.enforce(this.events, all);
        if (!removed.size) continue;
        console.warn(`Property ${property.constructor.name} enforced, ${removed.size} events dropped.`);
        this.events = this.events.filter(event => !removed.has(event.id));
        changed = true; break;
      }
      if (!changed) return;
    }
  }
  appendEvent(event: ViewEvent): void {
    if (event.kind === "condensation") {
      const forgotten = new Set(event.forgotten ?? []); this.events = this.events.filter(e => !forgotten.has(e.id));
      if (event.summary !== null && event.summary !== undefined && event.offset !== null && event.offset !== undefined) {
        this.events.splice(event.offset, 0, { id: `${event.id}-summary`, kind: "summary", convertible: true, summary: event.summary, ...(event.source ? { source: event.source } : {}) });
      }
      this.unhandledCondensationRequest = false;
    } else if (event.kind === "request") this.unhandledCondensationRequest = true;
    else if (event.convertible) this.events.push(event);
  }
  static fromEvents(events: ViewEvent[]): View {
    const view = new View(); for (const event of events) view.appendEvent(event); view.enforceProperties(events); return view;
  }
}
