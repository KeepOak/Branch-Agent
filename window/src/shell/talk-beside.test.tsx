// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TalkBeside } from "./TalkBeside";
import { talkRows, workContextFor } from "./talk-beside";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const KEY = "agent:sapling:main";
const asked = { role: "user", content: "What is this page?", timestamp: 1, __branch: { workContext: { snapshot: { page: "Canopy" } } } };
const answered = { role: "assistant", content: [{ type: "text", text: "Your board." }], stopReason: "stop", timestamp: 2 };

describe("talking beside a page: the rows and the context", () => {
  it("reads what the person said with its context and what the Trunk answered", () => {
    expect(talkRows([asked, answered], KEY)).toEqual([
      { kind: "you", key: "h:0", text: "What is this page?", context: [["Page", "Canopy"]] },
      { kind: "trunk", key: "h:1:0", text: "Your board." },
    ]);
  });

  it("sends the page within the engine's bounds, and nothing without a page name", () => {
    expect(workContextFor("Canopy", "")).toEqual({ page: "Canopy" });
    expect(workContextFor("x".repeat(80), "y".repeat(700))).toEqual({ page: "x".repeat(64), selection: "y".repeat(640) });
    expect(workContextFor("  ", "picked")).toBeUndefined();
  });
});

function type(el: HTMLTextAreaElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("the Talk to pane", () => {
  it("sends to the default Trunk's main conversation with the page, shows it answering until the engine says it ended", async () => {
    const messages: unknown[] = [];
    const listeners = new Set<(event: string, payload: unknown) => void>();
    const request = vi.fn(async (method: string, _params?: unknown) => (method === "chat.history" ? { messages: [...messages] } : { runId: "r1" }));
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () =>
      root?.render(
        <TalkBeside
          request={request as never}
          onEvent={(l) => (listeners.add(l), () => listeners.delete(l))}
          sessionKey={KEY}
          name="Sapling"
          page="Canopy"
          layout={{ open: true, dock: "right", w: 380, h: 320 }}
          onLayout={() => undefined}
          onFull={() => undefined}
        />,
      ),
    );
    expect(request).toHaveBeenCalledWith("chat.history", { sessionKey: KEY, limit: 60 });
    expect(host.textContent).toContain("Working on: Canopy");
    await act(async () => type(host.querySelector("textarea") as HTMLTextAreaElement, "What is this page?"));
    await act(async () => host.querySelector<HTMLButtonElement>(".talk-input button")?.click());
    expect(request).toHaveBeenCalledWith("chat.send", expect.objectContaining({ sessionKey: KEY, message: "What is this page?", workContext: { page: "Canopy" } }));
    expect(host.querySelector(".talk-typing")).not.toBeNull();
    messages.push(asked, answered);
    await act(async () => listeners.forEach((l) => l("chat", { sessionKey: KEY, state: "final", runId: "r1" })));
    expect(host.querySelector(".talk-typing")).toBeNull();
    expect(host.textContent).toContain("Your board.");
    expect(host.textContent).toContain("Context attached");
  });

  it("leaves the page out once its chip is removed", async () => {
    const request = vi.fn(async (method: string, _params?: unknown) => (method === "chat.history" ? { messages: [] } : {}));
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () =>
      root?.render(
        <TalkBeside request={request as never} onEvent={() => () => undefined} sessionKey={KEY} name="Sapling" page="Library" layout={{ open: true, dock: "bottom", w: 380, h: 320 }} onLayout={() => undefined} onFull={() => undefined} />,
      ),
    );
    await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='Remove work context']")?.click());
    expect(host.textContent).toContain("Include work context");
    await act(async () => type(host.querySelector("textarea") as HTMLTextAreaElement, "Hello"));
    await act(async () => host.querySelector<HTMLButtonElement>(".talk-input button")?.click());
    const send = request.mock.calls.find(([m]) => m === "chat.send")?.[1] as Record<string, unknown> | undefined;
    expect(send?.message).toBe("Hello");
    expect(send && "workContext" in send).toBe(false);
  });
});
