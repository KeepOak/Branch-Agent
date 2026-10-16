// @vitest-environment jsdom
// Parity row 3: the Classic helpers view re-hosted in R1, with item 44's Stop all and Tell it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Block } from "../../thread/model";
import { R1HelpersPanel } from "./R1HelpersPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

const ROOT = "agent:scout:main";
const ALL = ["sessions.list", "sessions.usage", "chat.history", "sessions.abort", "sessions.send", "canopy.cards.list"];
function engineWith(count: number, methods = ALL) {
  const helpers = Array.from({ length: count }, (_, i) => ({ key: `agent:scout:subagent:h${i}`, spawnedBy: ROOT, status: "running", label: `Reader ${i + 1}`, model: "connected", modelProvider: "openai" }));
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method === "sessions.list") return { sessions: params.spawnedBy === ROOT ? helpers : [] };
    if (method === "sessions.usage") return { totals: { totalCost: 1.25 } };
    if (method === "chat.history") return { messages: [{ role: "user", content: [{ type: "text", text: "Read the brief" }] }, { role: "assistant", content: [{ type: "thinking", thinking: "Checking the brief" }] }] };
    if (method === "canopy.cards.list") return { cards: [] };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: ROOT, agentId: "scout", scopes: ["operator.admin"], features: { methods, events: [] } } as unknown as WindowEngine;
  return { engine, request };
}
const AT = new Date(2026, 9, 13, 9, 41, 5).getTime();
const blocks: Block[] = [
  { kind: "user", key: "u1", text: "Look into it" },
  { kind: "step", key: "s1", tool: "read", title: "Read notes.md", detail: "", status: "ok", at: AT },
] as Block[];
async function render(engine: WindowEngine, onToast = vi.fn(), onClose = vi.fn()) {
  await act(async () => root.render(<R1HelpersPanel engine={engine} name="Scout" blocks={blocks} running={false} onClose={onClose} onToast={onToast} />));
  await flush();
  return { onToast, onClose };
}
const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text);

it("re-hosts the Classic step list with times and helper cards with What it's thinking, on clear glass", async () => {
  const { engine } = engineWith(1);
  await render(engine);
  const panel = host.querySelector(".r1-helpers");
  expect(panel?.classList.contains("g-clear")).toBe(true);
  expect(panel?.querySelector(".tl-pn li")?.textContent).toContain("Read a file");
  expect(panel?.querySelector(".tl-pn time")?.textContent).toBe(new Date(AT).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }));
  expect(panel?.querySelector('[aria-label="Helpers on this task"]')).not.toBeNull();
  expect(panel?.querySelector(".hp-think-pn summary")?.textContent).toBe("What it's thinking");
  expect(panel?.querySelector(".hp-think-pn p")?.textContent).toBe("Checking the brief");
  expect(panel?.querySelector('[aria-label="Stop Reader 1"]')).not.toBeNull();
  expect(button("Stop all")).toBeUndefined();
});

it("offers Stop all with 3 live helpers, behind a confirm, and aborts each one", async () => {
  const { engine, request } = engineWith(3);
  const { onToast } = await render(engine);
  await act(async () => button("Stop all")!.click());
  expect(request.mock.calls.some(([m]) => m === "sessions.abort")).toBe(false);
  expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain("Stop all 3 working helpers?");
  await act(async () => button("Stop 3")!.click());
  await flush();
  expect(request.mock.calls.filter(([m]) => m === "sessions.abort").map(([, p]) => (p as { key: string }).key)).toEqual(["agent:scout:subagent:h0", "agent:scout:subagent:h1", "agent:scout:subagent:h2"]);
  expect(onToast).toHaveBeenCalledWith("Stopped 3 helpers. Scout carries on without them.");
});

it("Tell it sends the message to the chosen working helper with sessions.send", async () => {
  const { engine, request } = engineWith(2);
  const { onToast } = await render(engine);
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="Which helper"]')!;
  await act(async () => { select.value = "agent:scout:subagent:h1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  const input = host.querySelector<HTMLInputElement>('input[placeholder="Tell it…"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(input, "Skip the appendix"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => host.querySelector<HTMLFormElement>('form[aria-label="Tell a helper"]')!.requestSubmit());
  await flush();
  const sent = request.mock.calls.find(([m]) => m === "sessions.send")?.[1] as Record<string, unknown>;
  expect(sent).toMatchObject({ key: "agent:scout:subagent:h1", message: "Skip the appendix" });
  expect(onToast).toHaveBeenCalledWith("Told Reader 2. It picks this up at its next step.");
});

it("shows Tell it and Stop all as Coming when the engine lacks their calls", async () => {
  const { engine } = engineWith(3, ALL.filter((m) => m !== "sessions.send" && m !== "sessions.abort"));
  await render(engine);
  expect(host.querySelector('input[placeholder="Tell it…"]')?.getAttribute("aria-disabled")).toBe("true");
  expect(button("Stop all")?.getAttribute("aria-disabled")).toBe("true");
});

it("Close hands the panel back", async () => {
  const { engine } = engineWith(1);
  const { onClose } = await render(engine);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close activity"]')!.click());
  expect(onClose).toHaveBeenCalled();
});
