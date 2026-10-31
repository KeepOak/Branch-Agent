import { expect, it } from "vitest";
import type { Block } from "./model";
import { ownLastMessageIndex } from "./own-last-message";

function own(key: string, extra?: { entryId?: string; owner?: boolean; sender?: { kind: "person"; id: string; name: string } }): Block {
  return { kind: "user", key, text: key, ...(extra ? { meta: extra } : {}) };
}

it("picks the latest message with no sender, and skips replies", () => {
  const blocks: Block[] = [
    own("u1"),
    { kind: "text", key: "a1", text: "reply", streaming: false },
    own("u2"),
  ];
  expect(ownLastMessageIndex(blocks, null)).toBe(2);
});

it("skips an earlier own message once a later one is yours", () => {
  const blocks: Block[] = [own("u1", { entryId: "e1" }), own("u2", { entryId: "e2" })];
  expect(ownLastMessageIndex(blocks, null)).toBe(1);
});

it("does not treat another person's message as yours when nobody is signed in", () => {
  const blocks: Block[] = [
    own("u1"),
    own("u2", { sender: { kind: "person", id: "dana", name: "Dana" } }),
  ];
  expect(ownLastMessageIndex(blocks, null)).toBe(0);
});

it("treats a matching profile, or a message the engine marks as the owner's, as yours", () => {
  const dana = own("u1", { sender: { kind: "person", id: "dana", name: "Dana" } });
  const mine = own("u2", { sender: { kind: "person", id: "me", name: "You" } });
  expect(ownLastMessageIndex([dana, mine], "me")).toBe(1);
  expect(ownLastMessageIndex([own("u1", { sender: { kind: "person", id: "dana", name: "Dana" }, owner: true })], "me")).toBe(0);
});

it("counts a profile message as yours while the profile id is still loading", () => {
  const blocks: Block[] = [own("u1", { sender: { kind: "person", id: "me", name: "You" } })];
  expect(ownLastMessageIndex(blocks, undefined)).toBe(0);
  expect(ownLastMessageIndex([], null)).toBe(-1);
});
