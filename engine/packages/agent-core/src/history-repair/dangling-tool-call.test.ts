// From bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/tests/test_dangling_tool_call_middleware.py (atlas AGENT-LOOP-0092). Vitest ports compare complete pinned outputs and preserve input immutability.
import { expect, it, vi } from "vitest";
import { fixtures } from "./dangling-tool-call.fixtures.js";
import { buildPatchedMessages, wrapModelCall, type ReplayMessage } from "./dangling-tool-call.js";
for (const fixture of fixtures) it(fixture.name, () => {
  const input = structuredClone(fixture.input); const before = structuredClone(input);
  expect(buildPatchedMessages(input)).toEqual(fixture.expected); expect(input).toEqual(before);
});
for (const asynchronous of [false, true]) for (const patched of [false, true]) {
  it(`forwards ${asynchronous ? "async" : "sync"} ${patched ? "patched" : "unchanged"} requests`, async () => {
    const input = fixtures.find(f => patched ? f.expected !== null : f.expected === null)!;
    type Request = { messages: ReplayMessage[]; override: (args: { messages: ReplayMessage[] }) => Request };
    const override = vi.fn((args: { messages: ReplayMessage[] }): Request => ({ ...request, ...args }));
    const request: Request = { messages: input.input, override };
    const handler = vi.fn((_request: Request) => asynchronous ? Promise.resolve("response") : "response");
    expect(await wrapModelCall(request, handler)).toBe("response"); expect(handler).toHaveBeenCalledOnce();
    if (patched) { expect(override).toHaveBeenCalledExactlyOnceWith({ messages: input.expected }); expect(handler.mock.calls[0]?.[0]).not.toBe(request); }
    else { expect(override).not.toHaveBeenCalled(); expect(handler).toHaveBeenCalledExactlyOnceWith(request); }
  });
}
