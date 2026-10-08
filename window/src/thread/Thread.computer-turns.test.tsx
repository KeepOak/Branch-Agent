// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerActivityCard } from "./ComputerActivityCard";
import { Thread } from "./Thread";
import type { Block } from "./model";
import type { WindowEngine } from "../connect/engine";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }) });
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const user = (key: string, words: string): Block => ({ kind: "user", key, text: words });
const reply = (key: string, words: string): Block => ({ kind: "text", key, text: words, streaming: false });
const step = (key: string, tool: string, title: string, runId: string): Block => ({
  kind: "step",
  key,
  outputKey: `${runId}:${key}`,
  tool,
  title,
  detail: `${title} detail`,
  status: "ok",
});

const history: Block[] = [
  user("u1", "Open the garden site"),
  step("b1", "browser", "Opened the garden site", "run-browser"),
  reply("t1", "The garden site is open."),
  user("u2", "Use this computer"),
  step("c1", "computer", "Clicked Sign in", "run-computer"),
  step("c2", "computer", "Typed the email", "run-computer"),
  reply("t2", "Signed in."),
  user("u3", "Write a short story about an oak"),
  reply("t3", "An oak stood by the river."),
  user("u4", "Capital of Canada?"),
  reply("t4", "Ottawa."),
];

function engine(): WindowEngine {
  return {
    sessionKey: "agent:main:main",
    scopes: [],
    onEvent: () => () => {},
    request: (async (method: string) => {
      if (method === "sessions.list") return { sessions: [] };
      if (method === "users.prefs.get") return { status: "ok", entries: {} };
      if (method === "users.self") return { id: "owner" };
      if (method === "session.reactions.list") return { reactions: {} };
      if (method === "exec.approval.list" || method === "plugin.approval.list") return { items: [] };
      return {};
    }) as WindowEngine["request"],
  };
}

describe("computer cards stay on their own turn", () => {
  it("does not merge two turns into one card, and keeps the newest text reply last", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root!.render(
        <Thread
          name="Ada"
          history={history}
          live={[]}
          pendingUser={null}
          running={false}
          engine={engine()}
          onAnswer={() => {}}
          supplement={<ComputerActivityCard blocks={history} running={false} name="Ada" onWatch={() => {}} />}
        />,
      ),
    );

    const cards = [...container.querySelectorAll(".acts-card-st, .comp-card-st")];
    expect(cards).toHaveLength(2);
    expect(cards[0].textContent).toContain("1 action");
    expect(cards[0].textContent).toContain("Done");
    expect(cards[1].textContent).toContain("2 actions");
    expect(cards[1].textContent).toContain("Done");
    expect(container.textContent).not.toContain("3 actions");
    expect(container.textContent).not.toContain("7 actions");

    const threadItems = [...container.querySelectorAll('[data-testid="message"], .acts-card-st, .comp-card-st')];
    const last = threadItems.at(-1);
    expect(last?.getAttribute("data-testid")).toBe("message");
    expect(last?.getAttribute("data-role")).toBe("assistant");
    expect(last?.textContent).toContain("Ottawa.");
    expect(container.textContent!.lastIndexOf("Used")).toBeLessThan(container.textContent!.lastIndexOf("Ottawa."));
  });
});
