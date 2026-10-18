// @vitest-environment jsdom
// Private #1089 (Linux pass, Regular): a failed run read "Researcher couldn’t finish: TypeError: Cannot read properties of
// undefined (reading 'path') at runTool (/app/…/run.js:41:12)" or "… couldn’t finish: connect ECONNREFUSED 127.0.0.1:18789".
// The run-error line now names the failure in a plain sentence at Regular; Advanced keeps the engine's words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import { shortReason } from "../../thread/format";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label: string }) => <span data-face={label} /> }));
vi.mock("../../composer/useConversation", () => ({ useConversation: () => ({ loaded: false }), hasNoModel: () => true }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /unknown method|logbook\.status|unknown agent id|ECONNREFUSED|127\.0\.0\.1|TypeError|runTool|:\d+:\d+|ENOENT|EACCES|NotInstalledError/;
const FAILURES: [string, string][] = [
  ["unknown method: logbook.status", "This part of Branch isn’t ready on this computer yet. Update Branch, then try again."],
  ['unknown agent id "main"', "That Trunk isn’t on this computer. Choose another Trunk."],
  ["connect ECONNREFUSED 127.0.0.1:18789", "Branch can’t reach its engine right now. It keeps trying, so try again in a moment."],
  ["TypeError: Cannot read properties of undefined (reading 'path')\n    at runTool (/app/engine/dist/tools/run.js:41:12)", "That didn’t work. Try again."],
  ["ENOENT: no such file or directory, open '/home/alex/notes/plan.md'", "That file or folder isn’t there. Check that it still exists, then try again."],
];

let root: Root, host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.unstubAllGlobals(); });
const runError = async (message: string) => {
  await act(async () => root.render(<ChatView name="Researcher" history={[{ kind: "error", key: "r1:error", runId: "r1", message }]} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} />));
  return host.querySelector('[data-testid="run-error"] .r1c-notice-text')?.textContent ?? "";
};

describe("a failed run never shows the engine's raw words at Regular (Private #1089)", () => {
  it.each(FAILURES)("%j", async (raw, plain) => {
    const line = await runError(raw);
    expect(line).not.toMatch(RAW);
    expect(line).toBe(`Researcher couldn’t finish: ${plain}`);
  });

  it("a run that failed for want of Codex shows main's Connect a model notice, not the error name", async () => {
    await runError("CodexNotInstalledError: Codex is not installed.");
    expect(host.querySelector('[data-testid="connect-model"]')).not.toBeNull();
    expect(host.textContent ?? "").not.toMatch(RAW);
  });

  it("offers the engine's words (Details, Copy error) only at Technical", async () => {
    await runError("connect ECONNREFUSED 127.0.0.1:18789");
    const buttons = () => [...host.querySelectorAll('[data-testid="run-error"] button')].map((b) => b.textContent);
    expect(buttons()).not.toContain("Details");
    expect(buttons()).not.toContain("Copy error");
    localStorage.setItem("branch.level", "technical");
    await act(async () => root.unmount()); root = createRoot(host);
    await runError("connect ECONNREFUSED 127.0.0.1:18789");
    expect(buttons()).toContain("Details");
    expect(buttons()).toContain("Copy error");
  });

  it("a failed history load offers Details only at Technical", async () => {
    const raw = "TypeError: Cannot read properties of undefined (reading 'path')\n    at runTool (/app/engine/dist/tools/run.js:41:12)";
    const render = () => act(async () => root.render(<ChatView name="Researcher" history={[]} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} loadError={raw} onReload={() => undefined} />));
    const notice = () => host.querySelector('[data-testid="load-error"]');
    const buttons = () => [...(notice()?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
    await render();
    expect(notice()?.querySelector(".r1c-notice-text")?.textContent).toBe("Couldn’t load this conversation");
    expect(buttons()).not.toContain("Details");
    expect(notice()?.querySelector("pre")).toBeNull();
    expect(notice()?.textContent ?? "").not.toMatch(RAW);
    localStorage.setItem("branch.level", "technical");
    await act(async () => root.unmount()); root = createRoot(host);
    await render();
    expect(buttons()).toContain("Details");
    await act(async () => (notice()?.querySelector('button[aria-expanded]') as HTMLButtonElement).click());
    expect(notice()?.querySelector("pre")?.textContent).toBe(raw);
  });

  it("keeps a plain engine sentence as it was", () => {
    expect(shortReason("Model quota exceeded. Retry after 2 minutes. stack: x")).toBe("Model quota exceeded.");
  });

  it("Advanced keeps the engine's first sentence", async () => {
    localStorage.setItem("branch.level", "advanced");
    expect(await runError("unknown method: logbook.status")).toBe("Researcher couldn’t finish: unknown method: logbook.status");
  });

  it.each(["", "advanced", "technical"])("never names GatewayLockError on a failed run at %j", async (level) => {
    if (level) localStorage.setItem("branch.level", level);
    const raw = "GatewayLockError: failed to acquire gateway state ownership: Branch Agent state database is busy at state/branch.sqlite";
    const line = await runError(raw);
    expect(line).toBe("Researcher couldn’t finish: Branch is busy right now. Try again in a moment.");
    expect(line).not.toMatch(/GatewayLockError/);
    expect(host.textContent ?? "").not.toMatch(/GatewayLockError/);
  });
});
