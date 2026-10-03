import { Value } from "typebox/value";
import { expect, it } from "vitest";
import { SessionsCreateParamsSchema } from "./sessions-create.js";
import { SessionsListParamsSchema } from "./sessions-list.js";
import { SESSION_TYPE_VALUES, SessionRowSchema } from "./sessions-row.js";

it("preserves the exact pinned Goose type enum and legacy optional wire shape", () => {
  expect(SESSION_TYPE_VALUES).toEqual([
    "user",
    "scheduled",
    "sub_agent",
    "hidden",
    "terminal",
    "gateway",
    "acp",
  ]);
  expect(Value.Check(SessionsCreateParamsSchema, {})).toBe(true);
  expect(Value.Check(SessionRowSchema, { key: "legacy", kind: "direct" })).toBe(true);
  for (const sessionType of SESSION_TYPE_VALUES) {
    expect(Value.Check(SessionsCreateParamsSchema, { sessionType })).toBe(true);
    expect(Value.Check(SessionRowSchema, { key: "typed", kind: "direct", sessionType })).toBe(true);
    expect(Value.Check(SessionsListParamsSchema, { sessionTypes: [sessionType] })).toBe(true);
  }
});
it("rejects malformed creation/discovery types and accepts an empty native selection", () => {
  for (const sessionType of [null, 7, "draft", "Hidden", {}]) {
    expect(Value.Check(SessionsCreateParamsSchema, { sessionType })).toBe(false);
    expect(Value.Check(SessionsListParamsSchema, { sessionTypes: [sessionType] })).toBe(false);
  }
  expect(Value.Check(SessionsListParamsSchema, { sessionTypes: [] })).toBe(true);
  expect(Value.Check(SessionsListParamsSchema, { sessionTypes: "acp" })).toBe(false);
});
