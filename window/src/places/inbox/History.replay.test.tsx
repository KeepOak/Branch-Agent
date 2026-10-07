// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { session } from "../overview/engine";
import { History, REPLAY_EMPTY, type HistoryData } from "./History";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../face/Face", () => ({ Face: ({ label, size }: { label?: string; size: number }) => <span role="img" aria-label={label} data-face-size={size} /> }));

const USER_MESSAGE = "Please tidy Downloads now.";
const FIRST_STEP = "ls Downloads";
const TITLE = "Tidy the Downloads folder";

const TRANSCRIPT = {
  messages: [
    { role: "user", content: USER_MESSAGE, timestamp: 1 },
    { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "exec", arguments: { command: FIRST_STEP } }], stopReason: "toolUse", timestamp: 2 },
    { role: "toolResult", toolCallId: "c1", toolName: "exec", content: [{ type: "text", text: "214 files" }], timestamp: 3 },
  ],
  hasMore: false,
};

const row = session({
  key: "agent:main:tidy",
  agentId: "main",
  label: TITLE,
  updatedAt: Date.now(),
  lastRunId: "r1",
  owner: { actor: { type: "human", id: "p1" } },
});

const data: HistoryData = {
  sessions: [row],
  runs: [],
  profiles: [{ id: "p1", displayName: "Robin" }],
  self: "p1",
  agents: { defaultId: "main", list: [{ id: "main", name: "Rowan", mode: "" }] },
  errors: [],
};

const empty: HistoryData = { sessions: [], runs: [], profiles: [], self: "", agents: { defaultId: "main", list: [] }, errors: [] };

let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

const engineWith = (request: WindowEngine["request"]): WindowEngine => ({ request, onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] });

async function render(history: HistoryData, request = vi.fn(async () => TRANSCRIPT)) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<History engine={engineWith(request as WindowEngine["request"])} data={history} level="regular" open={vi.fn()} />));
  return { host, request };
}

const btn = (host: ParentNode, label: string) => [...host.querySelectorAll("button")].filter(b => b.textContent?.trim() === label);
const click = async (b: HTMLElement | undefined) => { await act(async () => { b!.click(); await new Promise(r => setTimeout(r, 0)); }); };
const replaySrc = (host: ParentNode) => {
  const frame = host.querySelector<HTMLIFrameElement>("iframe[sandbox]");
  return frame?.srcdoc ?? frame?.getAttribute("srcdoc") ?? "";
};

describe("Inbox › History watch again", () => {
  it("opens Watch a task again with the transcript's first user message and first step", async () => {
    const { host, request } = await render(data);
    await click(btn(host, "Watch again")[0]);
    const dialog = document.querySelector('[data-testid="replay-dialog"]');
    expect(dialog?.getAttribute("aria-label")).toBe("Watch a task again");
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(request).toHaveBeenCalledWith("chat.history", { sessionKey: "agent:main:tidy", offset: 0, limit: 100 });
    const html = replaySrc(document);
    expect(html).toContain(USER_MESSAGE);
    expect(html).toContain(FIRST_STEP);
    expect(html).toContain("branch-replay-play");
  });

  it("greys the top Watch button with a plain reason when nothing has run", async () => {
    const { host } = await render(empty);
    const top = btn(host, "Watch a task")[0];
    expect(top).toMatchObject({ disabled: true, title: REPLAY_EMPTY });
  });

  it("shows a load failure in the dialog", async () => {
    const { host } = await render(data, vi.fn(async () => { throw new Error("The conversation could not be loaded."); }));
    await click(btn(host, "Watch again")[0]);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("The conversation could not be loaded.");
  });
});
