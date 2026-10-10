// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadContext, type ThreadContextValue } from "./context";
import { TeamProposalBlock, stateFor, type TeamBlock } from "./TeamProposalBlock";
import type { TeamToolResult } from "./team-proposal";

const result: TeamToolResult = {
  proposal: {
    teamId: "2d60428e",
    goal: "Ship it",
    hash: "h1",
    roomId: "team-2d60428e",
    members: [
      {
        name: "Builder Researcher",
        role: "Researcher",
        job: "Find topics.",
        machine: "this",
        model: "anthropic/claude-sonnet",
      },
    ],
  },
  choices: { models: ["anthropic/claude-sonnet", "openai/gpt"], machines: ["this", "node-a"] },
};
const block: TeamBlock = { kind: "team", key: "k", result };

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function render(engine: unknown) {
  host = document.createElement("div");
  document.body.append(host);
  const value = {
    name: "Ada",
    toast: vi.fn(),
    running: false,
    engine,
  } as unknown as ThreadContextValue;
  root = createRoot(host);
  act(() =>
    root!.render(
      <ThreadContext.Provider value={value}>
        <TeamProposalBlock block={block} />
      </ThreadContext.Provider>,
    ),
  );
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

const setInput = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const button = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;
const flush = () =>
  act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });

describe("TeamProposalBlock", () => {
  it("sends Approve as trunks.team.approve with the proposal hash, and shows the answer", async () => {
    const request = vi.fn(async () => ({ status: "applied" }));
    const el = render({ request });

    act(() => button(el, "Approve team").click());
    await flush();

    expect(request).toHaveBeenCalledWith("trunks.team.approve", {
      goal: "Ship it",
      roles: [
        {
          name: "Researcher",
          job: "Find topics.",
          machine: "this",
          model: "anthropic/claude-sonnet",
        },
      ],
      proposalHash: "h1",
    });
    expect(el.querySelector('[data-testid="team-approval-card"]')?.getAttribute("data-state")).toBe(
      "applied",
    );
  });

  it("re-checks an edited team through the propose method before it can be approved", async () => {
    const request = vi.fn(async (method: string) =>
      method === "trunks.team.propose"
        ? { ...result, proposal: { ...result.proposal, hash: "h2" } }
        : {},
    );
    const el = render({ request });

    act(() => button(el, "Edit").click());
    const job = el.querySelector<HTMLInputElement>("input[value='Find topics.']")!;
    act(() => setInput(job, "Find three topics."));
    act(() => button(el, "Save team").click());
    await flush();

    expect(request).toHaveBeenCalledWith(
      "trunks.team.propose",
      expect.objectContaining({ goal: "Ship it" }),
    );
    expect(
      (
        request.mock.calls.find(([method]) => method === "trunks.team.propose")?.[1] as {
          roles: Array<{ job: string }>;
        }
      ).roles[0]?.job,
    ).toBe("Find three topics.");
  });

  it("shows the engine's refusal of a draft instead of approving it", async () => {
    const request = vi.fn(async () => {
      throw new Error("Model made/up is not set up here.");
    });
    const el = render({ request });

    act(() => button(el, "Edit").click());
    act(() => button(el, "Save team").click());
    await flush();

    expect(el.querySelector('[role="alert"]')?.textContent).toContain("is not set up here");
  });
});

describe("stateFor", () => {
  it("maps the engine's answers to the card's states, and never shows an unapplied team as created", () => {
    expect(stateFor("applied")).toBe("applied");
    expect(stateFor("declined")).toBe("declined");
    expect(stateFor("unavailable")).toBe("unavailable");
    expect(stateFor(undefined)).toBe("unavailable");
  });
});
