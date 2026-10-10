// @vitest-environment jsdom
// Preview spec-v23 index.html:18532 - under Lockdown only allow buttons disabled with specific tooltip
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalCard, ApprovalGroup } from "./ApprovalCard";
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
  allowedDecisions: ["allow-once", "allow-always", "deny"],
  expiresAtMs: Date.now() + 60_000,
  ...patch,
});

async function mount(element: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(element));
  return host;
}

describe("ApprovalCard under Lockdown", () => {
  it("exec card: the command toggle says what it does, Show command and then Hide command", async () => {
    const host = await mount(<ApprovalCard approval={approval("e2")} details={detail("e2", { plugin: false })} name="Sapling" onAnswer={vi.fn()} />);
    const toggle = host.querySelector<HTMLButtonElement>("[data-action=open]");
    expect(toggle?.textContent).toBe("Show command");
    await act(async () => toggle?.click());
    expect(host.querySelector<HTMLButtonElement>("[data-action=open]")?.textContent).toBe("Hide command");
  });

  it("exec card: Allow once and Always allow are disabled with the preview tooltip; Don't stays and answers deny", async () => {
    const onAnswer = vi.fn();
    const host = await mount(<ApprovalCard approval={approval("e1")} details={detail("e1", { plugin: false })} name="Sapling" onAnswer={onAnswer} disabled={true} />);
    const allowBtn = host.querySelector<HTMLButtonElement>("[data-action=allow]");
    const alwaysBtn = host.querySelector<HTMLButtonElement>("[data-action=always]");
    const denyBtn = host.querySelector<HTMLButtonElement>("[data-action=deny]");
    expect(allowBtn?.disabled).toBe(true);
    expect(allowBtn?.title).toBe("Lockdown is on: nothing leaves this computer.");
    expect(alwaysBtn?.disabled).toBe(true);
    expect(alwaysBtn?.title).toBe("Lockdown is on: nothing leaves this computer.");
    expect(denyBtn?.disabled).toBe(false);
    await act(async () => denyBtn?.click());
    expect(onAnswer).toHaveBeenCalledWith("e1", "deny");
  });

  it("ActionCard disables allow buttons with lockdown tooltip and keeps deny enabled", async () => {
    const onAnswer = vi.fn();
    const host = await mount(
      <ApprovalCard approval={approval("p1")} details={detail("p1", { plugin: true, allowedDecisions: ["allow-once", "deny"] })} name="Sapling" onAnswer={onAnswer} disabled={true} />
    );

    const allowBtn = host.querySelector<HTMLButtonElement>("[data-action=allow]");
    const denyBtn = host.querySelector<HTMLButtonElement>("[data-action=deny]");

    expect(allowBtn?.disabled).toBe(true);
    expect(allowBtn?.title).toBe("Lockdown is on: nothing leaves this computer.");

    expect(denyBtn?.disabled).toBe(false);
    expect(denyBtn?.title).toContain("Ctrl D");

    await act(async () => denyBtn?.click());
    expect(onAnswer).toHaveBeenCalledWith("p1", "deny");
  });

  it("GroupRow disables Yes but allows No under lockdown", async () => {
    const onAnswer = vi.fn();
    const details = new Map([["p1", detail("p1")], ["p2", detail("p2")]]);
    const host = await mount(
      <ApprovalGroup approvals={[approval("p1"), approval("p2")]} details={details} name="Sapling" onAnswer={onAnswer} disabled={true} />
    );

    const rows = host.querySelectorAll<HTMLElement>(".g-row");
    expect(rows.length).toBe(2);

    const yes = host.querySelectorAll<HTMLButtonElement>(".g-acts .btn.primary");
    const no = host.querySelectorAll<HTMLButtonElement>(".g-acts .btn.ghost");
    expect(yes).toHaveLength(2);
    expect(no).toHaveLength(2);
    for (const button of yes) {
      expect(button.disabled).toBe(true);
      expect(button.title).toBe("Lockdown is on: nothing leaves this computer.");
    }
    expect(host.querySelector<HTMLButtonElement>('[data-testid="yes-to-all"]')?.disabled ?? true).toBe(true);
    expect([...no].every((button) => !button.disabled)).toBe(true);
    await act(async () => no[0]!.click());
    expect(onAnswer).toHaveBeenCalledWith(expect.stringMatching(/^p[12]$/), "deny");
  });
});
