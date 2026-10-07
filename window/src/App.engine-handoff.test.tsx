// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { GatewayStatus } from "./connect/gateway";
import type { SaplingSession } from "./connect/session";

type Options = { url: string; onStatus: (status: GatewayStatus) => void; onEvent: (frame: { event: string; payload: unknown }) => void };
const fake = vi.hoisted(() => ({ gateways: [] as Array<{ options: Options; requests: Array<[string, unknown]>; stopped: boolean }>, transcript: [] as Record<string, unknown>[] }));
vi.mock("./connect/gateway", () => ({
  BranchGateway: class {
    options: Options;
    requests: Array<[string, unknown]> = [];
    stopped = false;
    constructor(options: Options) { this.options = options; fake.gateways.push(this); }
    start(): void {}
    stop(): void { this.stopped = true; }
    reconnectNow(): void {}
    async request(method: string, params?: unknown): Promise<unknown> {
      this.requests.push([method, params]);
      if (method === "chat.send") return { runId: this.options.url.endsWith(":1") ? "old-run" : "new-run" };
      if (method === "chat.history") return { messages: fake.transcript.map((entry) => ({ ...entry })) };
      if (method === "agents.list") return { agents: [{ id: "main", name: "Main" }], defaultId: "main" };
      if (method === "approval.history" || method === "exec.approval.list") return { items: [] };
      return {};
    }
  },
}));
vi.mock("./shell/WindowShell", () => ({
  WindowShell: ({ session, url }: { session: SaplingSession; url: string }) => {
    const [draft, setDraft] = useState("");
    return <div data-testid="resident-window"><span data-testid="target">{url}</span>
      <input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button onClick={() => void session.send(draft)}>Send</button>
      <span data-testid="history">{JSON.stringify(session.getSnapshot().history)}</span></div>;
  },
}));

const key = "agent:main:main";
const hello = { snapshot: { sessionDefaults: { mainSessionKey: key } }, auth: { scopes: [] }, policy: {} };
const settle = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  fake.gateways.length = 0;
  fake.transcript.length = 0;
  document.body.replaceChildren();
  delete (window as { branchDesktop?: unknown }).branchDesktop;
  vi.resetModules();
});

it("keeps the resident conversation while the old run finishes and sends the next message to the new engine", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let currentUrl = "ws://127.0.0.1:1";
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: currentUrl, getGatewayUrl: () => currentUrl, gatewayToken: "shared-token" };
  const { App } = await import("./App");
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<App />));
  const old = fake.gateways[0]!;
  await act(async () => old.options.onStatus({ phase: "connected", hello } as unknown as GatewayStatus));
  await settle();
  const resident = host.querySelector('[data-testid="resident-window"]');
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!;
  await act(async () => { input.value = "first"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(old.requests.filter(([method]) => method === "chat.send")).toHaveLength(1);

  currentUrl = "ws://127.0.0.1:2";
  await act(async () => window.dispatchEvent(new CustomEvent("branch:engine-handoff", { detail: { gatewayUrl: currentUrl } })));
  const next = fake.gateways[1]!;
  expect(old.stopped).toBe(false);
  expect(next.options.url).toBe(currentUrl);
  await act(async () => next.options.onStatus({ phase: "connected", hello } as unknown as GatewayStatus));
  await settle();
  expect(host.querySelector('[data-testid="resident-window"]')).toBe(resident);
  expect(host.querySelector('[data-testid="target"]')?.textContent).toBe(currentUrl);

  await act(async () => { input.value = "second"; input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(next.requests.filter(([method]) => method === "chat.send")).toHaveLength(1);
  expect(old.requests.filter(([method]) => method === "chat.send")).toHaveLength(1);

  fake.transcript.push({ role: "assistant", content: "old run finished", timestamp: 1 });
  await act(async () => old.options.onEvent({ event: "chat", payload: { sessionKey: key, runId: "old-run", state: "final" } }));
  await settle();
  expect(host.querySelector('[data-testid="history"]')?.textContent).toContain("old run finished");
  expect(old.stopped).toBe(true);
  expect(host.querySelector('[data-testid="resident-window"]')).toBe(resident);
});

// PENDING (engine per-session write lease): the running test above verifies the mounted window's handoff
// contract with controlled gateways. The cross-process case needs two real gateways sharing one profile:
// keep O BUSY, hand the window to N, let O finish and persist its run, then assert N's chat.history and
// the resident window both contain O's final response. Desktop currently drains/stops O before handoff.
it.todo("end to end: a BUSY old engine finishes its in-flight run into the resident window after handoff");
