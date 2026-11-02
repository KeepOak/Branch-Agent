// @vitest-environment jsdom
// #589: Your models only looked again after Add an account closed or on Try again, so a ChatGPT/Codex sign-in made
// outside the window (in a browser or a terminal) never showed up while setup was open. The step now runs
// branch.setup.detect again when the window comes back into focus (focus, or visibilitychange to visible): once per
// return, never while a detect is running, Say hello is busy or the Add an account dialog is open, without clearing the
// rows, the switches or a Say hello result. Its listeners go away with the step.
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import type { Hello } from "./model";
import { Models } from "./Models";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let visibility: DocumentVisibilityState = "visible";
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  visibility = "visible";
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const METHODS = [
  "branch.setup.detect",
  "branch.setup.verify",
  "branch.setup.activate",
  "models.authStatus",
  "trunks.template.starters",
];
const CLAUDE = {
  kind: "claude-cli",
  modelRef: "claude-cli/claude-sonnet-4-6",
  label: "Claude Code",
  detail: "Signed in",
  recommended: true,
  signedOut: false,
  confirmed: false,
};
const CHATGPT = {
  kind: "saved-auth:openai%3Aaccount-1",
  modelRef: "openai/gpt-5.5",
  label: "ChatGPT",
  detail: "Saved Codex login (browser) sign-in",
  recommended: true,
  signedOut: false,
  confirmed: true,
};

type Deferred = { promise: Promise<unknown>; resolve: (v: unknown) => void };
const deferred = (): Deferred => {
  let resolve!: (v: unknown) => void;
  const promise = new Promise<unknown>((r) => (resolve = r));
  return { promise, resolve };
};

/** detect answers with Claude Code only until signIn() runs (a ChatGPT login made outside the window). */
function fakeEngine() {
  let signedIn = false;
  let holdDetect: Deferred | null = null;
  let holdActivate: Deferred | null = null;
  const request = vi.fn(async (method: string, _params?: unknown): Promise<unknown> => {
    if (method === "branch.setup.detect") {
      const answer = { candidates: signedIn ? [CLAUDE, CHATGPT] : [CLAUDE] };
      if (holdDetect) await holdDetect.promise;
      return answer;
    }
    if (method === "branch.setup.activate") {
      if (holdActivate) await holdActivate.promise;
      return { ok: true, modelRef: CLAUDE.modelRef, latencyMs: 1200 };
    }
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
  return {
    engine,
    request,
    signIn: () => void (signedIn = true),
    holdDetect: () => (holdDetect = deferred()),
    holdActivate: () => (holdActivate = deferred()),
  };
}
const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  });
const button = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as
    | HTMLButtonElement
    | undefined;
const detects = (request: ReturnType<typeof vi.fn>) =>
  request.mock.calls.filter(([m]) => m === "branch.setup.detect").length;
const labels = (host: HTMLElement) =>
  [...host.querySelectorAll(".r1-ob-row b")].map((b) => b.textContent);
const switchOn = (host: HTMLElement, label: string) =>
  host.querySelector('[aria-label="Use ' + label + '"]')?.getAttribute("aria-checked");

/** The window loses focus (the person goes to a browser or a terminal) and comes back. */
const leaveAndFocus = () =>
  act(async () => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
  });
const hideAndShow = () =>
  act(async () => {
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });

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

it("a ChatGPT sign-in made outside the window shows up when the window comes back into focus", async () => {
  const fake = fakeEngine();
  const host = await show(fake.engine);
  expect(labels(host)).toEqual(["Claude Code"]);
  expect(detects(fake.request)).toBe(1);
  fake.signIn();
  await leaveAndFocus();
  await flush();
  expect(detects(fake.request)).toBe(2);
  expect(labels(host)).toEqual(["Claude Code", "ChatGPT"]);
});

it("the page turning visible again looks again too, once per return", async () => {
  const fake = fakeEngine();
  const host = await show(fake.engine);
  fake.signIn();
  await hideAndShow();
  // The same return also brings a focus event: still one look.
  await act(async () => window.dispatchEvent(new Event("focus")));
  await flush();
  expect(detects(fake.request)).toBe(2);
  expect(labels(host)).toEqual(["Claude Code", "ChatGPT"]);
  // Focus without having left first does nothing.
  await act(async () => window.dispatchEvent(new Event("focus")));
  await flush();
  expect(detects(fake.request)).toBe(2);
});

it("keeps the rows and switches while it looks, and never starts a second look while one runs", async () => {
  const fake = fakeEngine();
  const host = await show(fake.engine);
  await act(async () =>
    (host.querySelector('[aria-label="Use Claude Code"]') as HTMLButtonElement).click(),
  );
  expect(switchOn(host, "Claude Code")).toBe("false");
  fake.signIn();
  const hold = fake.holdDetect();
  await leaveAndFocus();
  await flush();
  expect(detects(fake.request)).toBe(2);
  // Still looking: the rows stay, no flicker back to "Looking on this computer…".
  expect(host.textContent).not.toContain("Looking on this computer");
  expect(labels(host)).toEqual(["Claude Code"]);
  await leaveAndFocus();
  await hideAndShow();
  await flush();
  expect(detects(fake.request)).toBe(2);
  await act(async () => hold.resolve(undefined));
  await flush();
  expect(labels(host)).toEqual(["Claude Code", "ChatGPT"]);
  expect(switchOn(host, "Claude Code")).toBe("false");
  expect(switchOn(host, "ChatGPT")).toBe("true");
});

it("does not look again while Say hello is busy, and keeps its result afterwards", async () => {
  const fake = fakeEngine();
  const hold = fake.holdActivate();
  const host = await show(fake.engine);
  await act(async () => button(host, "Say hello")!.click());
  await flush();
  expect(button(host, "Saying hello…")).toBeDefined();
  await leaveAndFocus();
  await flush();
  expect(detects(fake.request)).toBe(1);
  await act(async () => hold.resolve(undefined));
  await flush();
  expect(host.querySelector(".r1-ob-hello")?.textContent).toContain("answered in");
  fake.signIn();
  await leaveAndFocus();
  await flush();
  expect(detects(fake.request)).toBe(2);
  expect(labels(host)).toEqual(["Claude Code", "ChatGPT"]);
  expect(host.querySelector(".r1-ob-hello")?.textContent).toContain("answered in");
});

it("does not look again while the Add an account dialog is open", async () => {
  const fake = fakeEngine();
  const host = await show(fake.engine);
  await act(async () => button(host, "Add another")!.click());
  await flush();
  expect(document.querySelector(".r1-ob-dlg")).not.toBeNull();
  const before = detects(fake.request);
  await leaveAndFocus();
  await hideAndShow();
  await flush();
  expect(detects(fake.request)).toBe(before);
});

it("removes its listeners when the step goes away", async () => {
  const added = vi.spyOn(window, "addEventListener");
  const removedWin = vi.spyOn(window, "removeEventListener");
  const removedDoc = vi.spyOn(document, "removeEventListener");
  const fake = fakeEngine();
  await show(fake.engine);
  const focus = added.mock.calls.find(([type]) => type === "focus")?.[1];
  expect(focus).toBeDefined();
  await act(async () => root!.unmount());
  root = undefined;
  expect(removedWin.mock.calls.some(([type, fn]) => type === "focus" && fn === focus)).toBe(true);
  expect(removedWin.mock.calls.some(([type]) => type === "blur")).toBe(true);
  expect(removedDoc.mock.calls.some(([type]) => type === "visibilitychange")).toBe(true);
  await leaveAndFocus();
  await hideAndShow();
  await flush();
  expect(detects(fake.request)).toBe(1);
});
