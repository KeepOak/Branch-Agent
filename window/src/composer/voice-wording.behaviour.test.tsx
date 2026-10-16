// @vitest-environment jsdom
// Atlas VOICE-0127 (built fresh): next to the microphone are real words, never a raw locale key, and nothing empty:
// every control has a label or isn't shown.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import type { WindowEngine } from "./engine";
// A real window reaches the microphone and audio; jsdom does not, and the live entry needs both (windowCanCall).
Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia: () => Promise.resolve({ getTracks: () => [] }) }, configurable: true });
(globalThis as { AudioContext?: unknown }).AudioContext ??= class {};

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});

async function mount() {
  const request = vi.fn(async (method: string) => {
    if (method === "talk.catalog") return { transcription: { ready: true }, realtime: { ready: true } };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Oak", identity: { name: "Oak" } }] };
    if (method === "sessions.list") return { defaults: {}, sessions: [] };
    if (method === "models.list") return { models: [] };
    if (method === "models.authStatus") return { providers: [] };
    return {};
  });
  const engine: WindowEngine = { sessionKey: "agent:main:main", agentId: "main", request: request as unknown as WindowEngine["request"], onEvent: () => () => undefined, scopes: [] };
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Composer name="Oak" working={false} disabled={false} onSend={vi.fn()} onStop={vi.fn()} engine={engine} />));
  await vi.waitFor(() => expect(host.querySelector('[data-testid="talk-live"]')).not.toBeNull());
  return host;
}

describe("voice UI wording", () => {
  it("labels the microphone and live voice in real words, never a locale key", async () => {
    const host = await mount();
    expect(host.querySelector('[data-testid="dictate"]')?.getAttribute("aria-label")).toBe("Dictate into the box");
    expect(host.querySelector('[data-testid="talk-live"]')?.getAttribute("aria-label")).toBe("Talk live with voice");
    const words = [host.textContent ?? "", ...[...host.querySelectorAll("[aria-label],[title]")].flatMap((el) => [el.getAttribute("aria-label") ?? "", el.getAttribute("title") ?? ""])];
    for (const w of words) expect(w).not.toMatch(/\bvoice\.[a-z][A-Za-z]+\b/);
  });

  it("draws no empty box between the message box and the voice buttons", async () => {
    const host = await mount();
    expect(host.querySelector(".c-flags")).toBeNull();
    for (const b of host.querySelectorAll<HTMLButtonElement>(".c-btn")) expect((b.getAttribute("aria-label") ?? "").trim()).not.toBe("");
  });
});
