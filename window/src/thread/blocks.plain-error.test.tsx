// @vitest-environment jsdom
// Not-sent reasons and file-open toasts go through the issue 1700 helper.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { FRIENDLY_ERROR } from "../connect/friendly-error";
import type { WindowEngine } from "../connect/engine";
import { Notice, NotSent, resetStepsFoldChoice, StepsFold } from "./blocks";
import { ThreadContext } from "./context";
import type { Block } from "./model";
import { shortReason } from "./format";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  resetStepsFoldChoice();
  localStorage.clear();
});

type Step = Extract<Block, { kind: "step" }>;

const SAMPLE_ID = "00000000-0000-4000-8000-000000000000";
const STACK = "Error: boom\n    at send (connect/session.ts:12:3)";
const JSON_DUMP = '{"type":"error","error":{"message":"boom","type":"server_error"}}';
const RAW_REASONS = [
  STACK,
  JSON_DUMP,
  "HTTP 500: Internal Server Error",
  `run ${SAMPLE_ID} failed`,
  "unknown method: chat.send",
];

function assertSafe(text: string | null | undefined): void {
  expect(text).toBeTruthy();
  expect(text).not.toMatch(/Error:/);
  expect(text).not.toMatch(/^\s*[{[]/);
  expect(text).not.toMatch(/\bHTTP\s*[1-5]\d{2}\b/i);
  expect(text).not.toMatch(/\n\s*at\s+/);
  expect(text).not.toMatch(/:\d+:\d+/);
  expect(text).not.toMatch(new RegExp(SAMPLE_ID, "i"));
  expect(text).not.toMatch(/\bchat\.send\b/);
}

async function renderNotSent(reason: string) {
  const host = document.body.appendChild(document.createElement("div"));
  host.className = "thread";
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <NotSent text="Say hi" reason={reason} onRetry={() => undefined} onDiscard={() => undefined} />,
    ),
  );
  return host;
}

describe("NotSent visible reason", () => {
  it("shows a plain sentence for a stack, JSON, status, id or method name, including the hover title", async () => {
    for (const reason of RAW_REASONS) {
      const host = await renderNotSent(reason);
      const why = host.querySelector(".send-why") as HTMLElement;
      expect(why.textContent).toBe(FRIENDLY_ERROR);
      expect(why.getAttribute("title")).toBe(FRIENDLY_ERROR);
      assertSafe(why.textContent);
      assertSafe(why.getAttribute("title"));
      await act(async () => root!.unmount());
      root = undefined;
      host.remove();
    }
  });

  it("keeps already-plain copy unchanged", async () => {
    const host = await renderNotSent("Couldn't send this message.");
    const why = host.querySelector(".send-why") as HTMLElement;
    expect(why.textContent).toBe("Couldn't send this message.");
    expect(why.getAttribute("title")).toBe("Couldn't send this message.");
  });
});

describe("engine Notice text", () => {
  it.each([
    "Moved to Claude account 2.",
    "No other subscription is free, so it waits until then.",
  ])("keeps the account-limit notice and its next step whole: %s", async (nextStep) => {
    const text = `Claude account 1 hit its limit until Sat 2:00 AM. ${nextStep}`;
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root!.render(<Notice block={{ kind: "notice", key: "n", text }} />));
    expect(host.textContent).toBe(text);
  });

  it.each(["advanced", "technical"])("keeps plugin, JSON and path errors exact at %s", async (level) => {
    localStorage.setItem("branch.level", level);
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    for (const text of ["PLUGIN_STATE_READ_FAILED. Try again.", JSON_DUMP, "Failed in /tmp/example/log.txt. Try again."]) {
      expect(shortReason(text)).toBe(text);
      await act(async () => root!.render(<Notice block={{ kind: "notice", key: "n", text }} />));
      expect(host.textContent).toBe(text);
    }
  });

  it("shows a plain sentence for a raw connect failure", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    host.className = "thread";
    root = createRoot(host);
    await act(async () => root!.render(<Notice block={{ kind: "notice", key: "n", text: "connect ECONNREFUSED 127.0.0.1:19031" }} />));
    const line = host.querySelector("[data-testid='notice']")?.textContent ?? "";
    expect(line).toBe("Branch can’t reach its engine right now. It keeps trying, so try again in a moment.");
    expect(line).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|19031/);
  });

  it("keeps already-plain copy unchanged", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    host.className = "thread";
    root = createRoot(host);
    await act(async () => root!.render(<Notice block={{ kind: "notice", key: "n", text: "The Gateway restarted." }} />));
    expect(host.querySelector("[data-testid='notice']")?.textContent).toBe("The Gateway restarted.");
  });
});

describe("file card Open file toast", () => {
  it("toasts a plain sentence when opening a file fails with a raw dump", async () => {
    const toasts: string[] = [];
    const engine: WindowEngine = {
      sessionKey: "agent:main:main",
      scopes: [],
      onEvent: () => () => undefined,
      request: async () => {
        throw new Error(STACK);
      },
    };
    const host = document.body.appendChild(document.createElement("div"));
    host.className = "thread";
    root = createRoot(host);
    const step: Step = {
      kind: "step",
      key: "e",
      tool: "apply_patch",
      title: "src/dates.ts",
      detail: "",
      status: "ok",
      changes: [{ path: "src/dates.ts", added: 1, removed: 0, diff: "+ok" }],
    };
    await act(async () =>
      root!.render(
        <ThreadContext.Provider value={{ name: "Sapling", toast: (text) => toasts.push(text), running: false, engine, sessionKey: engine.sessionKey }}>
          <StepsFold steps={[step]} live={false} />
        </ThreadContext.Provider>,
      ),
    );
    await act(async () => {
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Open file")?.click();
    });
    expect(toasts).toEqual([FRIENDLY_ERROR]);
    assertSafe(toasts[0]);
  });
});
