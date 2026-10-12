// Group chat events were broadcast (server-methods/rooms.ts) but had no scope guard, so hasEventScope dropped them
// for every client: an open window or a Graft agent never heard a room change or a post.
import { describe, expect, it } from "vitest";
import { hasEventScope } from "./server-broadcast-scopes.js";

const client = (scopes: string[]) => ({ connect: { role: "operator", scopes } }) as never;

describe("group chat events reach readers", () => {
  it.each(["rooms.changed", "rooms.event"])(
    "%s goes to a reader and an admin, not to a scope-less client",
    (event) => {
      expect(hasEventScope(client(["operator.read"]), event)).toBe(true);
      expect(hasEventScope(client(["operator.admin"]), event)).toBe(true);
      expect(hasEventScope(client([]), event)).toBe(false);
    },
  );
});
