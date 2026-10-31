// @vitest-environment jsdom
// #589: a new user whose only model is a ChatGPT subscription reached the end of setup with no working model, because
// ChatGPT answers through Codex and Branch doesn't ship it. Your models now offers the same Get Codex question as
// Settings › Accounts (codex.runtime / codex.runtime.download) when a switched-on ChatGPT row waits for Codex, and Say
// hello asks it first instead of failing. Nothing downloads without Yes, and other models never ask about Codex.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { codexNeededLine, needsCodex, type Hello } from "./model";
import { Models } from "./Models";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const METHODS = [
  "branch.setup.detect",
  "branch.setup.verify",
  "branch.setup.activate",
  "models.authStatus",
  "trunks.template.starters",
  "codex.runtime",
  "codex.runtime.download",
  "codex.runtime.cancel",
];
const CHATGPT = {
  kind: "saved-auth:openai%3Aaccount-1",
  modelRef: "openai/gpt-5.5",
  label: "ChatGPT",
  detail: "Saved Codex login (browser) sign-in",
  recommended: true,
  signedOut: false,
  confirmed: true,
};
const CLAUDE = {
  kind: "claude-cli",
  modelRef: "claude-cli/claude-sonnet-4-6",
  label: "Claude Code",
  detail: "Signed in",
  recommended: true,
  signedOut: false,
  confirmed: false,
};
const ASK = "Download Codex 0.160.0 (134 MB)?";

function fakeEngine(
  candidates: unknown[],
  runtime: { state: string; message?: string },
  detect: Record<string, unknown> = {},
) {
  let state = runtime;
  const request = vi.fn(async (method: string, _params?: unknown): Promise<unknown> => {
    if (method === "branch.setup.detect") return { candidates, ...detect };
    if (method === "codex.runtime")
      return { ...state, ask: ASK, bytes: 134_311_083, version: "0.160.0" };
    if (method === "codex.runtime.download") {
      state = { state: "downloading", message: "Getting Codex ready (134 MB)… 29%" };
      return state;
    }
    if (method === "codex.runtime.cancel") return { cancelled: false, state: "download" };
    if (method === "branch.setup.activate")
      return { ok: true, modelRef: "openai/gpt-5.5", latencyMs: 1200 };
    return { ok: true };
  });
  const engine = {
    request,
    onEvent: () => () => {},
    sessionKey: null,
    agentId: "main",
    scopes: [],
    features: { methods: METHODS, events: [] },
  } as unknown as WindowEngine;
  return { engine, request };
}
const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  });
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined;
const calls = (request: ReturnType<typeof vi.fn>, method: string) =>
  request.mock.calls.filter(([m]) => m === method).map(([, p]) => p);

function Host({ engine }: { engine: WindowEngine }) {
  const [hello, setHello] = useState<Hello>(null);
  const [off, setOff] = useState<string[]>([]);
  return <Models engine={engine} off={off} onOff={setOff} hello={hello} onHello={setHello} />;
}
async function show(engine: WindowEngine) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <CapabilityProvider engine={engine}>
        <Host engine={engine} />
      </CapabilityProvider>,
    ),
  );
  await flush();
  return host;
}

it("tells which found connections answer through Codex", () => {
  expect(needsCodex(CHATGPT)).toBe(true);
  expect(
    needsCodex({
      kind: "codex-cli",
      modelRef: "openai/gpt-5.5",
      label: "Codex",
      detail: "Installed",
    }),
  ).toBe(true);
  expect(
    needsCodex({
      kind: "provider-auto:openai-codex",
      modelRef: "openai/gpt-5.5",
      label: "OpenAI",
      detail: "",
    }),
  ).toBe(true);
  expect(
    needsCodex({
      kind: "provider-auto:openai-api-key",
      modelRef: "openai/gpt-5.5",
      label: "OpenAI",
      detail: "API key",
    }),
  ).toBe(false);
  expect(needsCodex(CLAUDE)).toBe(false);
});

it("a ChatGPT-only setup offers Get Codex, and Say hello asks before anything is tried or downloaded", async () => {
  const { engine, request } = fakeEngine([CHATGPT], { state: "download" });
  const host = await show(engine);
  expect(host.querySelector('[data-testid="onboarding-codex"]')?.textContent).toContain(
    codexNeededLine("ChatGPT"),
  );
  expect(button(host, "Get Codex")?.dataset.need).toBe("codex.runtime.download");
  await act(async () => button(host, "Say hello")!.click());
  await flush();
  expect(host.querySelector('[data-testid="onboarding-codex-prompt"]')?.textContent).toContain(ASK);
  expect(calls(request, "branch.setup.activate")).toHaveLength(0);
  expect(calls(request, "branch.setup.verify")).toHaveLength(0);
  expect(calls(request, "codex.runtime.download")).toHaveLength(0);
  await act(async () => button(host, "Yes")!.click());
  await flush();
  expect(calls(request, "codex.runtime.download")).toEqual([{ confirmed: true }]);
  expect(host.querySelector('[data-testid="onboarding-codex"]')?.textContent).toContain(
    "Getting Codex ready (134 MB)… 29%",
  );
  expect(button(host, "Say hello")?.disabled).toBe(true);
});

it("Not now downloads nothing", async () => {
  const { engine, request } = fakeEngine([CHATGPT], { state: "download" });
  const host = await show(engine);
  await act(async () => button(host, "Get Codex")!.click());
  await flush();
  await act(async () => button(host, "Not now")!.click());
  await flush();
  expect(calls(request, "codex.runtime.download")).toHaveLength(0);
  expect(calls(request, "codex.runtime.cancel")).toHaveLength(1);
  expect(host.querySelector('[data-testid="onboarding-codex-prompt"]')).toBeNull();
});

it("with Codex ready, Say hello tries the ChatGPT connection straight away", async () => {
  const { engine, request } = fakeEngine([CHATGPT], { state: "ready" });
  const host = await show(engine);
  expect(host.querySelector('[data-testid="onboarding-codex"]')).toBeNull();
  await act(async () => button(host, "Say hello")!.click());
  await flush();
  expect(calls(request, "branch.setup.activate")).toEqual([
    { agentId: "main", kind: CHATGPT.kind, modelRef: CHATGPT.modelRef },
  ]);
});

// #2159 review: Say hello verifies a working model that's already set up, so an extra ChatGPT row that's switched on
// must not hold it back until Codex is downloaded.
it("a working non-Codex model already set up keeps Say hello free while a ChatGPT row is on", async () => {
  const CURRENT = {
    kind: "existing-model",
    modelRef: "anthropic/claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    detail: "In use now",
    credentials: true,
  };
  const { engine, request } = fakeEngine(
    [CURRENT, CHATGPT],
    { state: "download" },
    {
      configuredModel: "anthropic/claude-sonnet-4-6",
      setupComplete: true,
    },
  );
  const host = await show(engine);
  expect(calls(request, "codex.runtime")).toHaveLength(0);
  expect(host.querySelector('[data-testid="onboarding-codex"]')).toBeNull();
  expect(button(host, "Get Codex")).toBeUndefined();
  expect(button(host, "Say hello")?.disabled).toBe(false);
  await act(async () => button(host, "Say hello")!.click());
  await flush();
  expect(host.querySelector('[data-testid="onboarding-codex-prompt"]')).toBeNull();
  expect(calls(request, "branch.setup.verify")).toEqual([{ agentId: "main" }]);
  expect(calls(request, "branch.setup.activate")).toHaveLength(0);
  expect(calls(request, "codex.runtime.download")).toHaveLength(0);
});

it("with the working model switched off, the ChatGPT row is what Say hello tests, so it asks for Codex", async () => {
  const CURRENT = {
    kind: "existing-model",
    modelRef: "anthropic/claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    detail: "In use now",
    credentials: true,
  };
  const { engine, request } = fakeEngine(
    [CURRENT, CHATGPT],
    { state: "download" },
    {
      configuredModel: "anthropic/claude-sonnet-4-6",
    },
  );
  const host = await show(engine);
  await act(async () =>
    (host.querySelector('[aria-label="Use Claude Sonnet 4.6"]') as HTMLButtonElement).click(),
  );
  await flush();
  expect(button(host, "Get Codex")).toBeDefined();
  await act(async () => button(host, "Say hello")!.click());
  await flush();
  expect(host.querySelector('[data-testid="onboarding-codex-prompt"]')?.textContent).toContain(ASK);
  expect(calls(request, "branch.setup.verify")).toHaveLength(0);
});

it("other models never ask about Codex", async () => {
  const { engine, request } = fakeEngine([CLAUDE], { state: "download" });
  const host = await show(engine);
  expect(calls(request, "codex.runtime")).toHaveLength(0);
  expect(host.querySelector('[data-testid="onboarding-codex"]')).toBeNull();
  expect(button(host, "Get Codex")).toBeUndefined();
});

it("switching the ChatGPT row off drops the Codex question", async () => {
  const { engine } = fakeEngine([CHATGPT, CLAUDE], { state: "download" });
  const host = await show(engine);
  expect(button(host, "Get Codex")).toBeDefined();
  await act(async () =>
    (host.querySelector('[aria-label="Use ChatGPT"]') as HTMLButtonElement).click(),
  );
  await flush();
  expect(button(host, "Get Codex")).toBeUndefined();
});
