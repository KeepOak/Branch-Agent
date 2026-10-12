import { describe, expect, it } from "vitest";
import { callFor, listItems, readAsk, settledFromEvent, settledText } from "./model";

const EMAIL = { id: "p1", expiresAtMs: 99, request: { title: "Send this email to Dana Okafor?", description: "To: Dana Okafor\nSubject: Thursday\nSee you then.", agentId: "ledger", sessionKey: "agent:ledger:main", allowedDecisions: ["allow-once", "deny"] } };

describe("approvals model", () => {
  it("reads a plugin's send as the question, its facts and the answers it allows", () => {
    const ask = readAsk("plugin", EMAIL)!;
    expect(ask).toMatchObject({ id: "p1", kind: "plugin", title: "Send this email to Dana Okafor?", facts: [["To", "Dana Okafor"], ["Subject", "Thursday"]], body: "See you then.", allowed: ["allow-once", "deny"], agentId: "ledger", sessionKey: "agent:ledger:main", expiresAtMs: 99 });
    expect(ask.words).toMatchObject({ yes: "Send it", no: "Don’t send", done: "Sent" });
    expect(callFor(ask, "allow-once")).toEqual({ method: "plugin.approval.resolve", params: { id: "p1", decision: "allow-once" } });
    expect(callFor(ask, "allow-always")).toBeNull();
    expect(settledText(ask, "allow-once", "Ledger").text).toBe("✓ Sent");
    expect(settledText(ask, "deny", "Ledger").text).toBe("✕ Declined");
  });

  it("masks an exec command's secrets, keeps deny available and carries the reviewer seam", () => {
    const ask = readAsk("exec", { id: "e1", request: { command: "curl -H 'Authorization: Bearer abc123' x", cwd: "/w", allowedDecisions: ["allow-once"] } })!;
    expect(ask.code).toContain("Bearer ••••••••");
    expect(ask.facts).toEqual([["Computer", "This computer"], ["Folder", "/w"]]);
    expect(ask.allowed).toEqual(["allow-once", "deny"]);
    const reviewer = { channel: "slack", accountId: "a", senderId: "s" };
    expect(callFor({ ...ask, reviewer }, "deny")).toEqual({ method: "exec.approval.resolve", params: { id: "e1", decision: "deny", reviewer } });
  });

  it("reads a pending question and answers or skips it through question.resolve", () => {
    const ask = readAsk("question", { id: "q1", status: "pending", createdAtMs: 1, expiresAtMs: 2, questions: [{ questionId: "pick", header: "Flight", question: "Which flight?", options: [{ label: "Morning" }, { label: "Evening", value: "pm" }] }] })!;
    expect(ask.questions[0].options).toEqual([{ label: "Morning", value: "Morning" }, { label: "Evening", value: "pm" }]);
    expect(callFor(ask, { answers: { pick: ["pm"] } })).toEqual({ method: "question.resolve", params: { id: "q1", answers: { answers: { pick: ["pm"] } } } });
    expect(callFor(ask, "skip")).toEqual({ method: "question.resolve", params: { id: "q1", cancel: true } });
    expect(readAsk("question", { id: "q2", status: "answered", questions: [{ questionId: "a", question: "?" }] })).toBeNull();
  });

  it("lists every list shape and tells an expiry from an answer elsewhere", () => {
    expect(listItems([1])).toEqual([1]);
    expect(listItems({ approvals: [2] })).toEqual([2]);
    expect(listItems({ questions: [3] })).toEqual([3]);
    expect(settledFromEvent("question", { id: "q", status: "expired" })).toBe("expired");
    expect(settledFromEvent("exec", { id: "e", decision: "allow-once" })).toBe("elsewhere");
  });
});
