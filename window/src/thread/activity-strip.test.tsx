// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpersTree } from "./Helpers";
import type { WindowEngine } from "../connect/engine";
import { useHelpers } from "./useEngineData";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let container: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; vi.useRealTimers(); });
async function render(node: React.ReactNode) {
  if (!root) { container = document.createElement("div"); document.body.append(container); root = createRoot(container); }
  await act(async () => root!.render(node));
}
const engine = (request: WindowEngine["request"]): WindowEngine => ({ request, sessionKey: "root", scopes: [], onEvent: () => () => {} });

describe("inline helper activity", () => {
  it("never shows the previous conversation's helpers while the next conversation loads", async () => {
    let resolve!: (v: unknown) => void;
    const request = vi.fn().mockImplementation(async (_method, params) => {
      if (params.spawnedBy === "root") return { sessions: [{ key: "one", spawnedBy: "root", label: "Old helper", status: "done" }] };
      if (params.spawnedBy === "next") return new Promise(r => { resolve = r; });
      return { sessions: [] };
    });
    const connection = engine(request);
    function Probe() { const { helpers } = useHelpers(connection); return <div>{helpers.map(h => h.name).join(",")}</div>; }
    await render(<Probe />);
    expect(container.textContent).toBe("Old helper");
    connection.sessionKey = "next";
    await render(<Probe />);
    expect(container.textContent).toBe("");
    await act(async () => resolve({ sessions: [] }));
    expect(container.textContent).toBe("");
  });
  it("shows nested task, status, error, open, approval and stop controls without opening a popover", async () => {
    const onStop = vi.fn(), onAnswer = vi.fn(), onOpenSession = vi.fn();
    const helpers = [{ key: "one", parent: "root", name: "Research", status: "running", task: "Compare sources" }, { key: "two", parent: "one", name: "Review", status: "done", error: "Partial result" }];
    await render(<HelpersTree root="root" helpers={helpers} approvals={[]} onStop={onStop} onAnswer={onAnswer} onOpenSession={onOpenSession} />);
    expect(container.querySelectorAll('[data-testid="helper"]')).toHaveLength(2);
    expect(container.textContent).toContain("Compare sources");
    expect(container.textContent).toContain("Partial result");
    expect(container.textContent).not.toContain("on this computer");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Stop Research"]')!.click());
    expect(onStop).toHaveBeenCalledWith(helpers[0]);
    const open = [...container.querySelectorAll("button")].find(b => b.textContent === "Review")!;
    await act(async () => open.click());
    expect(onOpenSession).toHaveBeenCalledWith("two");
    expect(container.querySelector('[aria-label="Stop Review"]')).toBeNull();
  });
});
