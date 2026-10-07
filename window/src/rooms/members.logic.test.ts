import { describe, expect, it } from "vitest";
import type { Block } from "../thread/model";
import { describeMembers, isChatAppGroup, isRoom, NO_MEMBERS, readParticipants, withSenders } from "./members";

const names: Record<string, string> = { ledger: "Ledger", scout: "Scout" };
const trunkName = (id: string) => names[id] ?? id;

const session = {
  kind: "direct",
  expandedParticipants: [
    { identity: { type: "profile", id: "p-dana" }, label: "Dana Whitfield" },
    { identity: { type: "profile", id: "p-me" }, label: "Me" },
    { identity: { type: "agent", id: "scout" } },
    { identity: { type: "agent", id: "ledger" } },
    { identity: { type: "observation", id: "researcher", pluginId: "a2a", accountId: null, senderKind: "unknown" }, label: "researcher" },
  ],
};

const person = (id: string, name: string): Block => ({
  kind: "user",
  key: `u:${id}`,
  text: "hi",
  meta: { sender: { kind: "person", id, name } },
});

const outside = (id: string, name: string): Block => ({
  kind: "user",
  key: `a:${id}`,
  text: "hi",
  meta: { sender: { kind: "agent", id, name, channel: "a2a" } },
});

const trunk = (agentId: string): Block => ({
  kind: "text",
  key: `t:${agentId}`,
  text: "found both",
  streaming: false,
  meta: { sender: { kind: "trunk", agentId } },
});

describe("readParticipants", () => {
  it("sorts expandedParticipants into Trunks, people and outside agents and leaves out selfId", () => {
    expect(readParticipants(session, "ledger", "p-me")).toEqual({
      trunks: ["scout"],
      people: [{ id: "p-dana", name: "Dana Whitfield" }],
      agents: [{ id: "researcher", name: "researcher" }],
    });
  });

  it("falls back to participants when expandedParticipants is missing", () => {
    const row = {
      participants: [
        { identity: { type: "profile", id: "p-dana" }, label: "Dana Whitfield" },
        { identity: { type: "profile", id: "p-me" }, label: "Me" },
        { identity: { type: "agent", id: "scout" } },
        { identity: { type: "remote", id: "hermes", pluginId: "a2a" }, label: "Hermes Agent" },
        { identity: { type: "observation", id: "77", pluginId: "telegram" }, label: "Sam Lee" },
      ],
    };
    expect(readParticipants(row, "ledger", "p-me")).toEqual({
      trunks: ["scout"],
      people: [
        { id: "p-dana", name: "Dana Whitfield" },
        { id: "77", name: "Sam Lee" },
      ],
      agents: [{ id: "hermes", name: "Hermes Agent" }],
    });
  });

  it("leaves out a member with no name", () => {
    const row = {
      expandedParticipants: [
        { identity: { type: "profile", id: "p-ghost" }, label: "" },
        { identity: { type: "profile", id: "p-spaces" }, label: "   " },
        { identity: { type: "profile", id: "p-noname" } },
        { identity: { type: "observation", id: "anon", pluginId: "telegram" } },
        { identity: { type: "observation", id: "blank-a2a", pluginId: "a2a" }, label: "" },
        { identity: { type: "profile", id: "p-dana" }, label: "Dana Whitfield" },
      ],
    };
    expect(readParticipants(row, "ledger", "p-me")).toEqual({
      trunks: [],
      people: [{ id: "p-dana", name: "Dana Whitfield" }],
      agents: [],
    });
  });
});

describe("withSenders", () => {
  it("merges history senders without duplicates", () => {
    const base = readParticipants(session, "ledger", "p-me");
    const history: Block[] = [
      person("p-dana", "Dana Whitfield"),
      person("p-dana", "Dana Whitfield"),
      person("77", "Sam Lee"),
      person("77", "Sam Lee"),
      outside("researcher", "researcher"),
      outside("researcher", "researcher"),
      trunk("scout"),
      trunk("scout"),
      trunk("ledger"),
      person("p-me", "Me"),
      { kind: "user", key: "plain", text: "no identity" },
      { kind: "done", key: "d", runId: "r1" },
    ];
    expect(withSenders(base, history, "ledger", "p-me")).toEqual({
      trunks: ["scout"],
      people: [
        { id: "p-dana", name: "Dana Whitfield" },
        { id: "77", name: "Sam Lee" },
      ],
      agents: [{ id: "researcher", name: "researcher" }],
    });
  });

  it("leaves a nameless history sender out", () => {
    expect(withSenders(NO_MEMBERS, [person("p-ghost", ""), outside("blank", "")], "ledger", "p-me")).toEqual(NO_MEMBERS);
  });
});

describe("isChatAppGroup", () => {
  it("is true for kind group and chatType group or channel only", () => {
    expect(isChatAppGroup({}, "group")).toBe(true);
    expect(isChatAppGroup({ kind: "group" }, "direct")).toBe(true);
    expect(isChatAppGroup({ chatType: "group" }, "direct")).toBe(true);
    expect(isChatAppGroup({ chatType: "channel" }, "direct")).toBe(true);
    expect(isChatAppGroup({ kind: "direct", chatType: "dm" }, "direct")).toBe(false);
    expect(isChatAppGroup({}, "direct")).toBe(false);
    expect(isChatAppGroup({}, undefined)).toBe(false);
  });
});

describe("isRoom", () => {
  it("is true when another Trunk, person or outside agent is present, false for a one-to-one chat", () => {
    expect(isRoom({ kind: "direct" }, "direct", { trunks: ["scout"], people: [], agents: [] })).toBe(true);
    expect(isRoom({ kind: "direct" }, "direct", { trunks: [], people: [{ id: "p-dana", name: "Dana" }], agents: [] })).toBe(true);
    expect(isRoom({ kind: "direct" }, "direct", { trunks: [], people: [], agents: [{ id: "researcher", name: "researcher" }] })).toBe(true);
    expect(isRoom({ kind: "direct" }, "direct", NO_MEMBERS)).toBe(false);
    expect(isRoom(session, "direct", readParticipants(session, "ledger", "p-me"))).toBe(true);
  });

  it("is true for a chat-app group even with no other members listed", () => {
    expect(isRoom({ kind: "group", chatType: "group" }, "group", NO_MEMBERS)).toBe(true);
    expect(isRoom({ chatType: "channel" }, "direct", NO_MEMBERS)).toBe(true);
  });
});

describe("describeMembers", () => {
  it("uses the preview's first names, Trunks, outside agents, then and you", () => {
    const members = readParticipants(session, "ledger", "p-me");
    // Preview grp-make (spec-v23): `${names.join(', ')} and you` — people first names, Trunks, agents.
    // Seeded Month-end room: "Dana, Ledger, Scout, Hermes Agent and you".
    expect(describeMembers(members, "Ledger", trunkName)).toBe("Dana, Ledger, Scout, researcher and you");
    expect(describeMembers({
      trunks: ["scout"],
      people: [{ id: "p-dana", name: "Dana Whitfield" }],
      agents: [{ id: "hermes", name: "Hermes Agent" }],
    }, "Ledger", trunkName)).toBe("Dana, Ledger, Scout, Hermes Agent and you");
    expect(describeMembers({ trunks: ["scout"], people: [], agents: [] }, "Ledger", trunkName)).toBe("Ledger, Scout and you");
    expect(describeMembers(NO_MEMBERS, "Ledger", trunkName)).toBe("Ledger and you");
  });

  it("does not repeat a name that already appears", () => {
    expect(describeMembers({
      trunks: ["ledger", "scout"],
      people: [{ id: "p-dana", name: "Dana Whitfield" }],
      agents: [],
    }, "Ledger", trunkName)).toBe("Dana, Ledger, Scout and you");
  });
});
