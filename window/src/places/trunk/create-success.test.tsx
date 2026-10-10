// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { ConversationList } from "../../connect/conversations";
import { conversationActions } from "../../shell/conversation-actions";
import { notify } from "../../shell/notify";
import { TrunksTab } from "../customize/trunks";

vi.mock("../../shell/notify", () => ({ notify: vi.fn() }));
vi.mock("../../connect/session", () => ({ agentIdOf: (key: string) => key.split(":")[1] }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../../face/CharacterFace", () => ({ CharacterFace: () => <span /> }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.useRealTimers();
});
const roster = { defaultId: "oak", mainKey: "main", agents: [{ id: "oak", name: "Oak" }] };
const button = (text: string) => [...document.querySelectorAll("button")].find((item) => item.textContent === text);
async function click(text: string) {
  const target = button(text);
  expect(target).toBeDefined();
  await act(async () => target!.click());
}
async function mount(request: ReturnType<typeof vi.fn>) {
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () => root!.render(<TrunksTab
    engine={{ request, scopes: ["operator.admin"], onEvent: () => () => {}, sessionKey: null } as unknown as WindowEngine}
    level="regular" openConversation={() => {}} startConversation={() => {}}
    trunks={{ data: roster as never, loading: false, error: null, reload: () => {} }}
  />));
  await click("A new Trunk");
}

it("closes a successfully created Trunk without waiting for another roster read or showing an error", async () => {
  const request = vi.fn(async (method: string) => {
    if (method === "agents.create") return { ok: true, agentId: "fern" };
    if (method === "agents.list") throw new Error("Roster temporarily unavailable");
    return {};
  });
  await mount(request);
  await click("Make Trunk");
  expect(document.querySelector('[data-testid="new-trunk-preview"]')).toBeNull();
  expect(document.querySelector('[role="alert"]')).toBeNull();
  expect(notify).toHaveBeenCalledWith(expect.stringMatching(/is made\./));
});

it("does not offer a repeat create of the same name after a persisted receipt", async () => {
  const request = vi.fn(async (method: string) => {
    if (method === "agents.create") return { ok: true, agentId: "fern" };
    if (method === "agents.list") throw new Error("Roster temporarily unavailable");
    return {};
  });
  await mount(request);
  await click("Make Trunk");
  // The audit's second click must no longer be able to submit the saved choice.
  if (button("Make Trunk")) await click("Make Trunk");
  expect(request.mock.calls.filter(([method]) => method === "agents.create")).toHaveLength(1);
});

it("shows a plain real create failure and leaves the dialog available for retry", async () => {
  let failed = true;
  const request = vi.fn(async (method: string) => {
    if (method === "agents.create") {
      if (failed) throw new Error("Permission denied");
      return { ok: true, agentId: "fern" };
    }
    if (method === "agents.list") throw new Error("Roster temporarily unavailable");
    return {};
  });
  await mount(request);
  await click("Make Trunk");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Couldn’t create your Trunk. Try again.");
  expect(document.querySelector('[data-testid="new-trunk-preview"] [role="alert"]')).not.toBeNull();
  expect(button("Make Trunk")?.disabled).toBe(false);
  failed = false;
  await click("Make Trunk");
  expect(document.querySelector('[data-testid="new-trunk-preview"]')).toBeNull();
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it("retries the first conversation's creation-witness race without a false error", async () => {
  vi.useFakeTimers();
  let reads = 0;
  const request = vi.fn(async (method: string) => {
    if (method === "agents.list") return { defaultId: "fern", mainKey: "main" };
    if (method === "sessions.describe") {
      if (++reads === 1) throw new Error("Agent creation no longer owns its originally observed target");
      return { session: { key: "agent:fern:main", agentId: "fern", sessionId: "contact" } };
    }
    return {};
  }) as ReturnType<typeof vi.fn> & Parameters<typeof conversationActions>[0];
  const actions = conversationActions(request, new ConversationList(request, null), () => null);
  const opened = actions.create("fern");
  await vi.advanceTimersByTimeAsync(500);
  expect(await opened).toBe("agent:fern:main");
  expect(notify).not.toHaveBeenCalled();
  expect(request.mock.calls.filter(([method]) => method === "agents.create")).toHaveLength(0);
});
