import { describe, expect, it } from "vitest";
import { isGroupRow, projectConversation } from "./conversations";

const person = (id: string, name: string) => ({ identity: { type: "profile", id, name } });
const trunk = (id: string, name: string) => ({ identity: { type: "agent", id, name } });

describe("group rows", () => {
  it("names an unnamed group by who is in it, never by one member", () => {
    const row = projectConversation({ key: "agent:maple:room:r1", agentId: "maple", kind: "direct", participants: [trunk("maple", "Maple"), trunk("oak", "Oak"), person("u1", "Taofik Bishi")] }, null);
    expect(row.title).toBe("Group with Maple, Oak, Taofik Bishi");
    expect(isGroupRow(row)).toBe(true);
    expect(row.roomPicks).toEqual([{ kind: "trunk", name: "Maple" }, { kind: "trunk", name: "Oak" }]);
  });
  it("keeps a saved group name", () => {
    const row = projectConversation({ key: "agent:maple:room:r2", label: "Builders", kind: "group", participants: [trunk("maple", "Maple")] }, null);
    expect(row.title).toBe("Builders");
    expect(isGroupRow(row)).toBe(true);
  });
  it("leaves a single-person conversation alone", () => {
    const row = projectConversation({ key: "agent:maple:main", label: "Standup", kind: "direct", participants: [] }, null);
    expect(row.title).toBe("Standup");
    expect(row.roomPicks).toBeUndefined();
    expect(isGroupRow(row)).toBe(false);
  });
  it("never shows an id as a member name", () => {
    const row = projectConversation({ key: "agent:x:room:r3", kind: "direct", participants: [person("5660235788", "")] }, null);
    expect(row.title).toBe("");
    expect(row.roomPicks).toBeUndefined();
  });
});
