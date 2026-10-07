// From OpenHands/software-agent-sdk@0a9abc87641ad7ffe02e2dadf5e2cb3976b35217:tests/sdk/context/view/conftest.py (atlas AGENT-LOOP-0093). Vitest fixture runner for pinned upstream view/property cases.
import { expect, it, vi } from "vitest";
import { View } from "./view.js";
import { BatchAtomicityProperty } from "./batch-atomicity.js";
import { ToolCallMatchingProperty } from "./tool-call-matching.js";
import { ToolLoopAtomicityProperty } from "./tool-loop-atomicity.js";
import { ObservationUniquenessProperty } from "./observation-uniqueness.js";
import type { ViewProperty, ViewEvent } from "./view-types.js";
export interface Fixture { name: string; op: string; property?: string; input: ViewEvent[]; all?: ViewEvent[] | null; expected: unknown; unhandled?: boolean }
const properties: Record<string, ViewProperty> = { BatchAtomicityProperty: new BatchAtomicityProperty(), ToolCallMatchingProperty: new ToolCallMatchingProperty(), ToolLoopAtomicityProperty: new ToolLoopAtomicityProperty(), ObservationUniquenessProperty: new ObservationUniquenessProperty() };
export function registerFixtures(fixtures: Fixture[]): void {
  const groups = new Map<string, Fixture[]>();
  for (const fixture of fixtures) { const group = groups.get(fixture.name) ?? []; group.push(fixture); groups.set(fixture.name, group); }
  for (const [name, cases] of groups) it(name, () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const fixture of cases) {
        const input = structuredClone(fixture.input); const before = structuredClone(input);
        if (fixture.op === "from_events") {
          const view = View.fromEvents(input); expect(view.events).toEqual(fixture.expected); expect(view.unhandledCondensationRequest).toBe(fixture.unhandled);
          for (const e of view.events) { const original = input.find(i => i.id === e.id); if (original) expect(e).toBe(original); }
        } else {
          const property = properties[fixture.property!];
          if (!property) throw new Error(`Unknown fixture property: ${fixture.property}`);
          const result = fixture.op === "enforce" ? property.enforce(input, fixture.all ?? []) : property.manipulationIndices(input);
          expect([...result].sort((a, b) => typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b)))).toEqual(fixture.expected);
        }
        expect(input).toEqual(before);
      }
      if (name.includes("warns_but_does_not_crash_on_duplicates")) expect(warn).toHaveBeenCalledWith(expect.stringContaining("Duplicate observation-like event for tool_call_id="));
    } finally { warn.mockRestore(); }
  });
}
