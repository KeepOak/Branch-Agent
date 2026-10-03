import { expect, it } from "vitest";
import { SESSION_TYPE_VALUES } from "../../../packages/gateway-protocol/src/schema/sessions-row.js";
import { normalizePersistedSessionEntryShape } from "./store-entry-shape.js";
import { mergeSessionEntry } from "./types.js";

it("round trips every source type and treats malformed persisted types as legacy User without inventing stored fields", () => {
  for (const sessionType of SESSION_TYPE_VALUES) {
    expect(
      normalizePersistedSessionEntryShape({ sessionId: "fixture", updatedAt: 1, sessionType })
        ?.sessionType,
    ).toBe(sessionType);
  }
  for (const sessionType of [undefined, null, "unknown", "draft", 7]) {
    expect(
      normalizePersistedSessionEntryShape({ sessionId: "fixture", updatedAt: 1, sessionType }),
    ).not.toHaveProperty("sessionType");
  }
});

it("preserves a stamped session type on same-key metadata updates and logical reset merges", () => {
  const existing = { sessionId: "fixture", updatedAt: 1, sessionType: "hidden" as const };
  expect(
    mergeSessionEntry(existing, { sessionType: "user", sessionId: "replacement" }),
  ).toMatchObject({ sessionId: "replacement", sessionType: "hidden" });
  expect(
    mergeSessionEntry({ sessionId: "legacy", updatedAt: 1 }, { displayName: "Updated" }),
  ).not.toHaveProperty("sessionType");
});
