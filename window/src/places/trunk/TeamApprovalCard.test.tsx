// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamApprovalCard, type TeamApprovalMember } from "./TeamApprovalCard";

const members: TeamApprovalMember[] = [
  {
    name: "Builder Scout",
    role: "Scout",
    job: "Find the sources.",
    machine: "this",
    model: "anthropic/claude-sonnet",
  },
];
const choices = { models: ["anthropic/claude-sonnet", "openai/gpt"], machines: ["this", "node-a"] };

const setInput = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;

function render(element: Parameters<Root["render"]>[0]) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
});

describe("TeamApprovalCard", () => {
  it("shows the team, one approve tap, and the plain cost line while it is asking", () => {
    const onApprove = vi.fn();
    const el = render(
      <TeamApprovalCard
        goal="Ship it"
        members={members}
        state="asking"
        choices={choices}
        onApprove={onApprove}
      />,
    );

    expect(el.textContent).toContain("Builder Scout");
    expect(el.textContent).toContain("Nothing is created until you approve.");
    expect(el.textContent).toContain(
      "Approving starts the team. Each job uses your anthropic/claude-sonnet account.",
    );
    const approve = el.querySelector<HTMLButtonElement>('[data-testid="team-approve"]');
    act(() => approve?.click());
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("disables both answers while the approval is still opening", () => {
    const el = render(<TeamApprovalCard goal="Ship it" members={members} state="opening" />);

    expect(el.querySelector<HTMLButtonElement>('[data-testid="team-approve"]')?.disabled).toBe(
      true,
    );
    expect(el.textContent).toContain("Opening the approval");
  });

  it("says the team is being created once the owner has allowed it", () => {
    const el = render(<TeamApprovalCard goal="Ship it" members={members} state="applying" />);

    expect(el.querySelector('[data-testid="team-approve"]')).toBeNull();
    expect(el.querySelector('[role="status"]')?.textContent).toContain(
      "Allowed. The team is being created now.",
    );
  });

  it.each([
    ["applied", "Team created."],
    ["declined", "Not created."],
    ["unavailable", "Nothing was created."],
  ] as const)("answers %s without buttons", (state, words) => {
    const el = render(<TeamApprovalCard goal="Ship it" members={members} state={state} />);

    expect(el.querySelector('[data-testid="team-approve"]')).toBeNull();
    expect(el.querySelector('[role="status"]')?.textContent).toContain(words);
  });

  it("lets the owner change the job and save it, with the choices offered", () => {
    const onSave = vi.fn();
    const el = render(
      <TeamApprovalCard
        goal="Ship it"
        members={members}
        state="asking"
        choices={choices}
        onSave={onSave}
      />,
    );

    act(() => el.querySelector<HTMLButtonElement>('[data-testid="team-edit"]')?.click());
    const machine = el.querySelector("select");
    expect([...(machine?.querySelectorAll("option") ?? [])].map((o) => o.textContent)).toEqual([
      "This computer",
      "node-a",
    ]);
    const job = el.querySelector<HTMLInputElement>("input[value='Find the sources.']")!;
    act(() => setInput(job, "Find three sources."));
    act(() =>
      [...el.querySelectorAll("button")].find((b) => b.textContent === "Save team")?.click(),
    );

    expect(onSave.mock.calls[0]?.[0]?.[0]).toMatchObject({
      job: undefined,
      role: "Scout",
      name: "Builder Scout",
      job: "Find three sources.",
    });
  });
});
