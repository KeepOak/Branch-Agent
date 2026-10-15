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
    machine: "This computer",
    model: "anthropic/claude-sonnet",
  },
];

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
  it("shows the team and one approve tap while it is asking", () => {
    const onApprove = vi.fn();
    const el = render(
      <TeamApprovalCard goal="Ship it" members={members} state="asking" onApprove={onApprove} />,
    );

    expect(el.textContent).toContain("Builder Scout");
    expect(el.textContent).toContain("Nothing is created until you approve.");
    const approve = el.querySelector<HTMLButtonElement>('[data-testid="team-approve"]');
    expect(approve?.textContent).toBe("Approve team");
    act(() => approve?.click());
    expect(onApprove).toHaveBeenCalledTimes(1);
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
});
