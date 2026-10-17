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
  ["CodexNotInstalledError: Codex is not installed.", "That isn’t installed on this computer. Install it, then try again."],
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

  it("keeps a plain engine sentence as it was", () => {
    expect(shortReason("Model quota exceeded. Retry after 2 minutes. stack: x")).toBe("Model quota exceeded.");
  });

  it("Advanced keeps the engine's first sentence", async () => {
    localStorage.setItem("branch.level", "advanced");
    expect(await runError("unknown method: logbook.status")).toBe("Researcher couldn’t finish: unknown method: logbook.status");
  });
});
