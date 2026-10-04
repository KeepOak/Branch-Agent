import { expect, it } from "vitest";
import { normalizeSessionEntrySlotKey } from "./session-entry-slot-keys.js";

it("prevents plugin extension slots from overwriting the core session type", () => {
  expect(normalizeSessionEntrySlotKey("sessionType")).toEqual({
    ok: false,
    error: "sessionEntrySlotKey is reserved by SessionEntry: sessionType",
  });
  expect(normalizeSessionEntrySlotKey("fixtureExtension")).toEqual({
    ok: true,
    key: "fixtureExtension",
  });
});
