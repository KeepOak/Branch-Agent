// @vitest-environment jsdom
// Codex fetched on first use (Private #983 part 3): the waiting Codex turn shows the download in the conversation, with
// Cancel; a cancelled download ends with "Cancelled"; offline (or any failure) says why, and Try again restarts it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { projectRun, type Block } from "../../thread/model";
import { ChatView, type ChatViewProps } from "./ChatView";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label: string }) => <span data-face={label} /> }));
vi.mock("../../composer/useConversation", () => ({ useConversation: () => ({ loaded: false }), hasNoModel: () => true }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); vi.useRealTimers(); });

const BYTES = 134_311_083;
const METHODS = ["chat.send", "codex.runtime", "codex.runtime.download", "codex.runtime.cancel"];
let seq = 0;
const status = (data: Record<string, unknown>) => ({ runId: "r9", seq: ++seq, stream: "run_status", ts: 1_760_000_000_000 + seq, data: { phase: "codex_download", ...data } });
const progress = (percent: number) => status({ state: "downloading", message: `Getting Codex ready (134 MB)… ${percent}%`, bytes: BYTES, received: Math.floor((BYTES * percent) / 100), percent });
const user: Block = { kind: "user", key: "u1", text: "Fix the failing test", meta: { entryId: "e1", timestamp: 1_760_000_000_000 } };

function engineOf(answers: (method: string) => unknown) {
  const request = vi.fn(async (method: string) => answers(method));
  const engine = { request, onEvent: () => () => undefined, sessionKey: "agent:scout:main", agentId: "scout", scopes: ["operator.admin"], features: { methods: METHODS, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}

async function show(engine: WindowEngine, props: Partial<ChatViewProps>) {
  await act(async () => root.render(<CapabilityProvider engine={engine}><ChatView name="Scout" history={[user]} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} engine={engine} sessionKey="agent:scout:main" {...props} /></CapabilityProvider>));
}
const line = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const link = (scope: HTMLElement | null, label: string) => [...(scope?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => b.textContent === label);
const click = async (button: HTMLButtonElement | undefined) => { expect(button).toBeDefined(); await act(async () => { button!.click(); await Promise.resolve(); }); };

it("projects the download as one line per run that updates in place, and drops the turn's error once the line says it", () => {
  const events = [progress(0), progress(42), status({ state: "failed", reason: "offline", message: "Codex isn't downloaded yet and this computer looks offline (ENOTFOUND)." }),
    { runId: "r9", seq: ++seq, stream: "lifecycle", ts: 0, data: { phase: "error", error: "Codex isn't downloaded yet and this computer looks offline (ENOTFOUND)." } }];
  const blocks = projectRun(events.slice(0, 2), new Map());
  expect(blocks.filter((b) => b.kind === "notice")).toEqual([expect.objectContaining({ key: "r9:codex_download", text: "Getting Codex ready (134 MB)… 42%", codex: expect.objectContaining({ state: "downloading", percent: 42 }) })]);
  // Not a startup phase: no status pill for it.
  expect(blocks.some((b) => b.kind === "status")).toBe(false);
  const ended = projectRun(events, new Map());
  expect(ended.filter((b) => b.kind === "notice").map((b) => b.kind === "notice" && b.codex?.state)).toEqual(["failed"]);
  expect(ended.some((b) => b.kind === "error")).toBe(false);
});

it("shows \"Getting Codex ready (134 MB)… 42%\" where the Codex turn waits, updating as it goes", async () => {
  const { engine } = engineOf(() => ({}));
  await show(engine, { running: true, live: projectRun([progress(3)], new Map()) });
  expect(line("codex-download")!.textContent).toContain("Getting Codex ready (134 MB)… 3%");
  // The download line replaces "Scout is thinking"; there is no question to answer.
  expect(line("typing")).toBeNull();
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  await show(engine, { running: true, live: projectRun([progress(3), progress(42)], new Map()) });
  expect(host.querySelectorAll('[data-testid="codex-download"]')).toHaveLength(1);
  expect(line("codex-download")!.textContent).toContain("Getting Codex ready (134 MB)… 42%");
  await show(engine, { running: true, live: projectRun([progress(42), status({ state: "ready", message: "Codex is ready.", bytes: BYTES })], new Map()) });
  expect(line("codex-download")).toBeNull();
  expect(line("codex-ready")!.textContent).toContain("Codex is ready.");
});

it("Cancel stops the download (codex.runtime.cancel) and the turn ends with a plain Cancelled", async () => {
  const { engine, request } = engineOf((method) => method === "codex.runtime.cancel" ? { cancelled: true, state: "download", reason: "not-downloaded", bytes: BYTES } : {});
  const live = projectRun([progress(42)], new Map());
  await show(engine, { running: true, live });
  await click(link(line("codex-download"), "Cancel"));
  expect(request.mock.calls.filter(([m]) => m === "codex.runtime.cancel")).toHaveLength(1);
  // The engine ends the waiting turn: its last line is Cancelled, then the run is over.
  await show(engine, { running: true, live: projectRun([progress(42), status({ state: "cancelled", message: "Cancelled" })], new Map()) });
  expect(line("codex-cancelled")!.textContent).toBe("Cancelled");
  await show(engine, { running: false, live: [], ended: { runId: "r9", outcome: "failed", at: Date.now() } });
  expect(line("codex-cancelled")!.textContent).toBe("Cancelled");
  expect(line("codex-download")).toBeNull();
  expect(line("run-error")).toBeNull();
});

it("offline: the reason stays after the turn, and Try again restarts the download until Codex is ready", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  const offline = "Codex isn't downloaded yet and this computer looks offline (ENOTFOUND). Connect to the internet and try again.";
  let runtime: Record<string, unknown> = { state: "unavailable", reason: "offline", bytes: BYTES, message: offline };
  const { engine, request } = engineOf((method) => {
    if (method === "codex.runtime.download") { runtime = { state: "downloading", bytes: BYTES, received: 0, message: "Getting Codex ready (134 MB)… 0%" }; return runtime; }
    if (method === "codex.runtime") return runtime;
    return {};
  });
  await show(engine, { running: true, live: projectRun([progress(0), status({ state: "failed", reason: "offline", message: offline })], new Map()) });
  await show(engine, { running: false, live: [], ended: { runId: "r9", outcome: "failed", at: Date.now() } });
  const failed = line("codex-failed")!;
  expect(failed.getAttribute("role")).toBe("alert");
  expect(failed.textContent).toContain("looks offline (ENOTFOUND)");
  await click(link(failed, "Try again"));
  expect(request.mock.calls.filter(([m]) => m === "codex.runtime.download")).toHaveLength(1);
  expect(line("codex-download")!.textContent).toContain("Getting Codex ready (134 MB)… 0%");
  runtime = { state: "downloading", bytes: BYTES, received: Math.floor(BYTES * 0.6), message: "Getting Codex ready (134 MB)… 60%" };
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(line("codex-download")!.textContent).toContain("Getting Codex ready (134 MB)… 60%");
  runtime = { state: "ready", source: "downloaded", command: "/state/tools/codex/0.160.0-darwin-arm64/node_modules/@openai/codex/bin/codex.js" };
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(line("codex-ready")!.textContent).toContain("Codex is ready");
  expect(line("codex-failed")).toBeNull();
});

it("an engine without the calls shows Cancel and Try again as Coming, and calls nothing", async () => {
  const request = vi.fn(async () => ({}));
  const engine = { request, onEvent: () => () => undefined, sessionKey: "agent:scout:main", agentId: "scout", scopes: ["operator.admin"], features: { methods: ["chat.send"], events: [] } } as unknown as WindowEngine;
  await show(engine, { running: true, live: projectRun([progress(10)], new Map()) });
  await click(link(line("codex-download"), "Cancel"));
  expect(request).not.toHaveBeenCalledWith("codex.runtime.cancel", expect.anything());
});
