import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { askIsHere, callFor, listItems, readAsk, settledFromEvent, settledText } from "./model";

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
    expect(askIsHere(ask, "agent:scout:main")).toBe(true);
    expect(askIsHere({ ...ask, sessionKey: "agent:ledger:main" }, "agent:scout:main")).toBe(false);
    expect(askIsHere(readAsk("exec", { id: "e1", request: { command: "ls" } })!, "agent:scout:main")).toBe(false);
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

describe("approvals glass model (README item 48)", () => {
  const css = readFileSync("src/screens/approvals/approvals.css", "utf8");
  const rgba = (s: string) => s.match(/rgba?\(([^)]+)\)/)![1].split(",").map(Number);
  const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const over = (c: number[], base: number[]) => [0, 1, 2].map((k) => c[k] * (c[3] ?? 1) + base[k] * (1 - (c[3] ?? 1)));
  const ratio = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  /* The pills use the shared pill tokens (theme/tokens.css), so the contrast is checked on those, in light and dark. */
  const tokens = readFileSync("src/theme/tokens.css", "utf8");
  const themes = [...tokens.matchAll(/--gp-fill: (rgba\([^)]+\)); --gp-edge: [^;]+; --gp-on: [^;]+; --gp-ink-2: (rgb\([^)]+\))/g)].map((m) => [rgba(m[1]), rgba(m[2])]);

  it("gives every pill ink at least 4.5:1 over white and over black, in light and dark", () => {
    expect(themes.length).toBeGreaterThanOrEqual(2);
    for (const [fill, ink] of themes) for (const wall of [[255, 255, 255], [0, 0, 0]]) expect(ratio(ink, over(fill, wall))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the card, drop and banners clear, outlines pills in 1px, and goes solid under Reduce transparency", () => {
    for (const sel of [".r1-ask {", ".r1-drop {", ".r1-banner {"]) expect(css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)))).toContain("background: transparent");
    expect(css).toContain("box-shadow: inset 0 0 0 1px var(--gp-edge)");
    expect(css).toContain("background: var(--gp-fill); -webkit-backdrop-filter: var(--gp-blur); backdrop-filter: var(--gp-blur);");
    const flat = tokens.replace(/\s+/g, " ");
    expect(flat).toMatch(/:root\[data-transparency="reduce"\][^{]*\{ --gp-fill: var\(--raise\);[^}]*--gp-blur: none; \}/);
    expect(flat).toMatch(/@media \(prefers-reduced-transparency: reduce\) \{[^{]*\{ --gp-fill: var\(--raise\);[^}]*--gp-blur: none; \}/);
    expect(css).not.toMatch(/border-(top|bottom):\s*1px/);
  });
});
