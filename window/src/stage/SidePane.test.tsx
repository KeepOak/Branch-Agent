// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WindowEngine } from "../connect/engine";
import { SidePane, type PaneTab } from "./SidePane";

vi.mock("../face/Face", () => ({ Face: () => null }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, container: HTMLDivElement;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => await Promise.resolve());
};
function engineWith(answers: Record<string, (p: any) => unknown>) {
  const listeners = new Set<(e: { event: string; payload?: unknown }) => void>();
  const request = vi.fn(async (method: string, params: any) => (answers[method] ? answers[method](params) : {}));
  const engine: WindowEngine = { request: request as any, sessionKey: "agent:a:one", scopes: ["operator.admin"], onEvent: (fn) => (listeners.add(fn), () => listeners.delete(fn)) };
  return { engine, request, emit: (event: string, payload: unknown) => listeners.forEach((fn) => fn({ event, payload })) };
}
async function render(engine: WindowEngine, tab: PaneTab = "Activity", onTab = vi.fn()) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<SidePane engine={engine} name="Ada" blocks={[]} running={false} card={null} cardError="" tab={tab} onTab={onTab} onClose={() => {}} toast={() => {}} />));
  await flush();
}
const tabs = () => [...container.querySelectorAll("[role=tab]")].map((t) => t.textContent);

describe("side pane", () => {
  it("shows Branches only when the conversation has two or more paths", async () => {
    await render(engineWith({}).engine);
    expect(tabs()).toEqual(["Activity", "Dashboard", "Timeline", "Plan", "Files", "Memory", "Terminal"]);
    await act(async () => root!.unmount());
    const two = { branches: [{ leafEntryId: "a", headline: "First", messageCount: 2, active: true }, { leafEntryId: "b", headline: "Second", messageCount: 3, active: false }] };
    await render(engineWith({ "sessions.branches.list": () => two }).engine);
    expect(tabs()).toContain("Branches");
  });
  it("opens a live shell, shows its output and sends a line", async () => {
    const { engine, request, emit } = engineWith({ "terminal.open": () => ({ sessionId: "t1", agentId: "a", shell: "bash", cwd: "/work/repo", confined: true }) });
    await render(engine, "Terminal");
    const open = [...container.querySelectorAll("button")].find((b) => b.textContent === "Open a terminal for me")!;
    await act(async () => open.click());
    await flush();
    expect(request).toHaveBeenCalledWith("terminal.open", { sessionKey: "agent:a:one", cols: 100, rows: 30 });
    await act(async () => emit("terminal.data", { sessionId: "t1", seq: 4, data: "\x1b[1mhi\x1b[0m\r\n" }));
    expect(container.querySelector(".shell-out-pn")!.textContent).toContain("hi");
    const input = container.querySelector<HTMLInputElement>('[aria-label="Type a command"]')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "ls");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => input.form!.requestSubmit());
    expect(request).toHaveBeenCalledWith("terminal.input", { sessionId: "t1", data: "ls\r" });
    await act(async () => root!.unmount());
    root = undefined;
    expect(request).toHaveBeenCalledWith("terminal.close", { sessionId: "t1" });
  });
  it("greys the shell when the connection lacks full access", async () => {
    const { engine } = engineWith({});
    await render({ ...engine, scopes: ["operator.read"] }, "Terminal");
    const open = [...container.querySelectorAll("button")].find((b) => b.textContent === "Open a terminal for me")!;
    expect(open.disabled).toBe(true);
  });
});
