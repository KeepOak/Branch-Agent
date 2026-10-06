// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useVoiceNote } from "./composer/VoiceParts";

const fake = vi.hoisted(() => ({ handoff: vi.fn(), recorderStops: 0 }));
vi.mock("./connect/session", () => ({
  SaplingSession: class {
    snapshot = { status: { phase: "connected", hello: {} } };
    getSnapshot = () => this.snapshot;
    subscribe = () => () => {};
    start(): void {}
    stop(): void {}
    reconnectNow(): void {}
    handoff(url: string, token: string): void { fake.handoff(url, token); }
  },
}));
vi.mock("./shell/WindowShell", () => ({
  WindowShell: ({ url }: { url: string }) => {
    const [draft, setDraft] = useState("");
    const note = useVoiceNote(() => {}, () => {});
    return <div><span data-testid="target">{url}</span><input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button onClick={() => void note.start()}>Record</button><span data-testid="recording">{note.on ? "on" : "off"}</span></div>;
  },
}));

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  delete (window as { branchDesktop?: unknown }).branchDesktop;
  fake.handoff.mockClear();
});

it("keeps the draft and active voice recorder mounted through a gateway target switch", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let currentUrl = "ws://127.0.0.1:1";
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: currentUrl, getGatewayUrl: () => currentUrl, gatewayToken: "shared-token" };
  const track = { stop: vi.fn() };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [track] }) } });
  vi.stubGlobal("MediaRecorder", class {
    mimeType = "audio/webm";
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    start(): void {}
    stop(): void { fake.recorderStops++; this.onstop?.(); }
  });
  const { App } = await import("./App");
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<App />));
  const draft = host.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(draft, "unfinished thought");
    draft.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { host.querySelector<HTMLButtonElement>("button")!.click(); });
  expect(host.querySelector('[data-testid="recording"]')?.textContent).toBe("on");

  await act(async () => window.dispatchEvent(new CustomEvent("branch:engine-handoff", { detail: { gatewayUrl: "ws://127.0.0.1:9999" } })));
  expect(fake.handoff).not.toHaveBeenCalled();
  currentUrl = "ws://127.0.0.1:2";
  await act(async () => window.dispatchEvent(new CustomEvent("branch:engine-handoff", { detail: { gatewayUrl: currentUrl } })));
  expect(fake.handoff).toHaveBeenCalledWith("ws://127.0.0.1:2", "shared-token");
  expect(host.querySelector('[data-testid="target"]')?.textContent).toBe("ws://127.0.0.1:2");
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Draft"]')?.value).toBe("unfinished thought");
  expect(host.querySelector('[data-testid="recording"]')?.textContent).toBe("on");
  expect(fake.recorderStops).toBe(0);
  expect(track.stop).not.toHaveBeenCalled();
});
