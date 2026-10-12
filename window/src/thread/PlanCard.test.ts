import { describe, expect, it } from "vitest";
import {readProgressCard} from "./PlanCard";
const card = {sessionKey: "agent:scout:one", revision: 2, updatedAt: 1000, steps: [{step:"Read the report", status:"completed"}, {step:"Save notes", status:"in_progress"}]};
describe("gateway plan card admission", () => {
  it("admits the native markdown-only value without inferring steps", () => {
    const note = { sessionKey: card.sessionKey, revision: 3, updatedAt: 2000, markdown: "A source-only update with [proof](https://example.test/proof)." };
    expect(readProgressCard(note, card.sessionKey)).toEqual(note);
    expect(readProgressCard({ ...note, steps: [] }, card.sessionKey)).toEqual({ ...note, steps: [] });
  });
  it("retains the gateway's actual step states", () => {expect(readProgressCard(card, card.sessionKey)).toEqual(card);});
  it("rejects another conversation's card", () => {expect(readProgressCard(card,"agent:ada:two")).toBeNull();});
  it("rejects malformed plan data before it reaches checklist rendering", () => {expect(readProgressCard({...card,steps:[{step:"Read",status:"done"}]},card.sessionKey)).toBeNull();expect(readProgressCard({...card,steps:{}},card.sessionKey)).toBeNull();});
});
