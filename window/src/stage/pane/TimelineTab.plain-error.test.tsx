// @vitest-environment jsdom
// Plan load and branch switch failures: one plain sentence at Regular, exact words at Advanced.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { BranchesTab, PlanTab } from "./TimelineTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|unknown method|logbook\.status/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:18789";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

describe("the plan and branches tabs never show a raw engine error at Regular", () => {
  it("names a failed plan read in a plain sentence", async () => {
    await act(async () => root.render(<PlanTab steps={[]} error={ENGINE} />));
    expect(host.textContent).toBe(REACH);
    expect(host.textContent).not.toMatch(RAW);
  });

  it("names a failed branch switch in a plain sentence", async () => {
    const onError = vi.fn();
    const request = vi.fn(async () => { throw new Error("unknown method: logbook.status"); });
    const engine = { request, sessionKey: "agent:scout:one", scopes: [], onEvent: () => () => {} } as unknown as WindowEngine;
    await act(async () => root.render(
      <BranchesTab engine={engine} paths={[{ leafEntryId: "a", headline: "Main", messageCount: 2, active: true }, { leafEntryId: "b", headline: "Other", messageCount: 1, active: false }]} onSwitched={() => undefined} onError={onError} />,
    ));
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Switch to it")!.click());
    expect(onError).toHaveBeenCalledWith("This part of Branch isn’t ready on this computer yet. Update Branch, then try again.");
    expect(String(onError.mock.calls.at(-1)?.[0] ?? "")).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    await act(async () => root.render(<PlanTab steps={[]} error={ENGINE} />));
    expect(host.textContent).toBe(ENGINE);
    const onError = vi.fn();
    const request = vi.fn(async () => { throw new Error(ENGINE); });
    const engine = { request, sessionKey: "agent:scout:one", scopes: [], onEvent: () => () => {} } as unknown as WindowEngine;
    await act(async () => root.render(
      <BranchesTab engine={engine} paths={[{ leafEntryId: "a", headline: "Main", messageCount: 1, active: false }]} onSwitched={() => undefined} onError={onError} />,
    ));
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Switch to it")!.click());
    expect(onError).toHaveBeenCalledWith(ENGINE);
  });
});
