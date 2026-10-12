// @vitest-environment jsdom
// The approval cards answer only what a request can still take: no Yes for a deny-only request, nothing for an expired
// one, and "Yes to both" never forwards an expired id (dot's r2-approvals review cases, ported beside the card).
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalCard, ApprovalGroup } from "./ApprovalCard";
import { canAnswer, isCurrent } from "./approval-guard";
import type { Approval } from "./model";
import type { ApprovalDetails } from "./useEngineData";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
const matchMedia = () => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() });
beforeEach(() => vi.stubGlobal("matchMedia", vi.fn(matchMedia)));
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const approval = (id: string): Approval => ({ id, state: "pending", command: "synthetic action" });
const detail = (id: string, patch: Partial<ApprovalDetails> = {}): ApprovalDetails => ({
  id,
  plugin: true,
  title: "Send this synthetic note?",
  description: "To: Synthetic recipient\nSubject: Synthetic subject",
  sessionKey: "agent:main:main",
  allowedDecisions: ["allow-once", "deny"],
  expiresAtMs: Date.now() + 60_000,
  ...patch,
});
async function mount(element: ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(element));
  return host;
}

describe("approval guard", () => {
  it("current means undecided and unexpired; a decision must be allowed", () => {
    const now = Date.now();
    expect(isCurrent(undefined, now)).toBe(true);
    expect(isCurrent(detail("a", { expiresAtMs: now - 1 }), now)).toBe(false);
    expect(isCurrent(detail("a", { decision: "deny" }), now)).toBe(false);
    expect(canAnswer(detail("a", { allowedDecisions: ["deny"] }), "allow-once", now)).toBe(false);
    expect(canAnswer(detail("a", { allowedDecisions: ["deny"] }), "deny", now)).toBe(true);
  });
});

describe("approval cards", () => {
  it("single plugin card honors allowed decisions and expiry", async () => {
    const onAnswer = vi.fn();
    const host = await mount(<ApprovalCard approval={approval("p1")} details={detail("p1", { allowedDecisions: ["deny"] })} name="Sapling" onAnswer={onAnswer} />);
    expect(host.querySelector("[data-action=allow]")).toBeNull();
    await act(async () => root!.render(<ApprovalCard approval={approval("p1")} details={detail("p1", { expiresAtMs: Date.now() - 1000 })} name="Sapling" onAnswer={onAnswer} />));
    expect(host.querySelector("button")).toBeNull();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("group does not offer Yes for a deny-only plugin request", async () => {
    const details = new Map([["p1", detail("p1", { allowedDecisions: ["deny"] })], ["p2", detail("p2")]]);
    const host = await mount(<ApprovalGroup approvals={[approval("p1"), approval("p2")]} details={details} name="Sapling" onAnswer={vi.fn()} />);
    const yes = host.querySelector<HTMLButtonElement>("[data-approval=p1] .primary");
    expect(yes === null || yes.disabled).toBe(true);
    expect(host.querySelector("[data-testid=yes-to-all]")).toBeNull();
  });

  it("group batch answer never forwards an expired approval", async () => {
    const onAnswer = vi.fn();
    const details = new Map([["p1", detail("p1", { expiresAtMs: Date.now() - 1000 })], ["p2", detail("p2")]]);
    const host = await mount(<ApprovalGroup approvals={[approval("p1"), approval("p2")]} details={details} name="Sapling" onAnswer={onAnswer} />);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=yes-to-all]")?.click());
    expect(onAnswer.mock.calls.some((c) => c[0] === "p1")).toBe(false);
    expect(host.querySelector("[data-approval=p1] button")).toBeNull();
    expect(host.querySelector("[data-approval=p1]")?.textContent).toContain("Expired");
  });

  it("Yes to both answers each once while both can be allowed", async () => {
    const onAnswer = vi.fn();
    const details = new Map([["p1", detail("p1")], ["p2", detail("p2")]]);
    const host = await mount(<ApprovalGroup approvals={[approval("p1"), approval("p2")]} details={details} name="Sapling" onAnswer={onAnswer} />);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=yes-to-all]")!.click());
    expect(onAnswer.mock.calls).toEqual([["p1", "allow-once"], ["p2", "allow-once"]]);
  });
});
