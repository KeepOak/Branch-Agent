// @vitest-environment jsdom
// The composer mic with no voice service on (Private #1095, walkthrough B-097): it was a dead, greyed button with a
// not-allowed cursor. Now it says "Turn on voice in Settings" and opens Settings › Voice & calls. With a voice service
// it still dictates, and an engine with no voice calls at all still shows it as Coming with its reason.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../composer/engine";
import type { OpenTarget } from "../../composer/nav";
import { Composer } from "./Composer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} }); });
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function mount(opts: { dictation?: boolean; methods?: string[] } = {}) {
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list") return { defaultId: "scout", agents: [{ id: "scout", name: "Scout" }] };
    if (method === "sessions.describe") return { session: { model: "openai/test", permissionMode: "guarded", thinkingLevel: "medium" } };
    if (method === "sessions.list") return { defaults: { model: "openai/test" }, sessions: [] };
    if (method === "models.list") return { models: [{ id: "test", provider: "openai", name: "Test Model", available: true }] };
    if (method === "models.authStatus") return { providers: [] };
    if (method === "talk.catalog") return { transcription: { ready: Boolean(opts.dictation) }, realtime: { ready: false } };
    return {};
  });
  const engine = { sessionKey: "agent:scout:main", agentId: "scout", request, onEvent: () => () => {}, scopes: ["operator.admin"],
    ...(opts.methods ? { features: { methods: opts.methods, events: [] } } : {}) } as unknown as WindowEngine;
  const opened = vi.fn<(target: OpenTarget) => void>();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Composer name="Scout" engine={engine} working={false} offline={false} onSend={() => {}} onStop={() => {}} onToast={() => {}}
    onOpen={opened} onOpenConversation={() => {}} limits={null} topics={[]} running={[]} />));
  return { host, opened, request };
}
const mic = () => document.querySelector<HTMLButtonElement>('.r1c-pill button[aria-label="Dictate into the box"]');

describe("the composer mic with voice off", () => {
  it("is a live button that says Turn on voice in Settings and opens Settings › Voice & calls", async () => {
    const { opened } = await mount({ dictation: false });
    const button = mic();
    expect(button).not.toBeNull();
    expect(button?.closest("[data-coming]")).toBeNull();
    expect(button?.getAttribute("aria-disabled")).not.toBe("true");
    expect(button?.title).toBe("Turn on voice in Settings");
    await act(async () => button!.click());
    const card = document.querySelector('[data-testid="mic-off"]');
    expect(card?.textContent).toContain("Turn on voice in Settings");
    const open = [...(card?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Open Settings");
    expect(open).toBeDefined();
    await act(async () => open!.click());
    expect(opened).toHaveBeenCalledWith("settings/voice");
    expect(document.querySelector('[data-testid="mic-off"]')).toBeNull();
  });

  it("closes again on a second click, and nothing in it says a class, method or file name", async () => {
    await mount({ dictation: false });
    await act(async () => mic()!.click());
    const words = document.querySelector('[data-testid="mic-off"]')?.textContent ?? "";
    expect(words).toContain("Turn on voice in Settings");
    expect(words).not.toMatch(/talk\.|catalog|transcription|\.tsx?\b|Error/);
    await act(async () => mic()!.click());
    expect(document.querySelector('[data-testid="mic-off"]')).toBeNull();
  });

  it("still dictates when a voice service is on, and stays Coming on an engine with no voice calls", async () => {
    await mount({ dictation: true });
    expect(mic()?.title).toBe("Dictate into the box");
    expect(mic()?.closest("[data-coming]")).toBeNull();
    await act(async () => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    await mount({ dictation: false, methods: [] });
    expect(mic()?.closest("[data-coming]") ?? mic()?.getAttribute("data-coming")).toBeTruthy();
  });
});

describe("the composer mic when this window cannot use it", () => {
  it("says why in plain words and opens Settings › Permissions", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException("Permission denied", "NotAllowedError")) },
    });
    const { opened, request } = await mount({ dictation: true });
    request.mockImplementation(async (method: string) => {
      if (method === "talk.session.create") return { sessionId: "s1", audio: { inputEncoding: "g711_ulaw", inputSampleRateHz: 8000 } };
      if (method === "talk.catalog") return { transcription: { ready: true }, realtime: { ready: false } };
      if (method === "agents.list") return { defaultId: "scout", agents: [{ id: "scout", name: "Scout" }] };
      if (method === "sessions.describe") return { session: { model: "openai/test", permissionMode: "guarded", thinkingLevel: "medium" } };
      if (method === "sessions.list") return { defaults: { model: "openai/test" }, sessions: [] };
      if (method === "models.list") return { models: [{ id: "test", provider: "openai", name: "Test Model", available: true }] };
      if (method === "models.authStatus") return { providers: [] };
      return {};
    });
    await act(async () => mic()!.click());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const note = document.querySelector('[data-testid="mic-denied"]');
    expect(note?.textContent).toContain("Branch can’t use the microphone");
    expect(note?.textContent).toContain("Settings › Permissions");
    expect(note?.textContent).not.toMatch(/NotAllowedError|getUserMedia|DOMException|\.tsx?\b/);
    const open = [...(note?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Open Settings");
    expect(open).toBeDefined();
    await act(async () => open!.click());
    expect(opened).toHaveBeenCalledWith("settings/permissions");
  });
});
