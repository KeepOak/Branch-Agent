// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_tool_call_metadata.py (atlas AGENT-LOOP-0092). Full metadata equality and content identity checks from upstream scenarios.
import { expect, it } from "vitest";
import { fixtures } from "./tool-call-metadata.fixtures.js";
import { cloneAiMessageWithToolCalls } from "./tool-call-metadata.js";
for (const fixture of fixtures) it(fixture.name, () => {
  const input = structuredClone(fixture.input); const before = structuredClone(input);
  const result = cloneAiMessageWithToolCalls(input, fixture.calls, fixture.content ?? undefined);
  expect(result).toEqual(fixture.expected); expect(result.content === input.content).toBe(fixture.sameContent);
  expect(input).toEqual(before);
});
