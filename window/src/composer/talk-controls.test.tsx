// @vitest-environment jsdom
// DA-16: voice controls that can't run are left out, not drawn greyed with a reason nobody sees.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { conversationMenuItems, type ConversationMenuContext, type ConversationMenuRun } from "../shell/conversation-menu";
import type { MenuItem } from "../shell/Menu";
import { Composer } from "./Composer";
import type { WindowEngine } from "./engine";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  localStorage.clear();
});

async function mount(catalog: { transcription: boolean; realtime: boolean }) {
  const request = vi.fn(async (method: string) => {
    if (method === "talk.catalog") return { transcription: { ready: catalog.transcription }, realtime: { ready: catalog.realtime } };
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", name: "Oak", identity: { name: "Oak" } }] };
    if (method === "sessions.list") return { defaults: {}, sessions: [] };
    if (method === "models.list") return { models: [] };
    if (method === "models.authStatus") return { providers: [] };
    return {};
  });
  const engine: WindowEngine = {
    sessionKey: "agent:main:main",
    agentId: "main",
    request: request as unknown as WindowEngine["request"],
    onEvent: () => () => undefined,
    scopes: [],
  };
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<Composer name="Oak" working={false} disabled={false} onSend={vi.fn()} onStop={vi.fn()} engine={engine} />));
  await vi.waitFor(() => expect(request).toHaveBeenCalledWith("talk.catalog", {}));
  await act(async () => await new Promise((r) => setTimeout(r, 0)));
  return host;
}

describe("DA-16 composer voice buttons", () => {
  it("draws no greyed microphone or live-voice button when no voice service is ready", async () => {
    const host = await mount({ transcription: false, realtime: false });
    expect(host.querySelector('[data-testid="dictate"]')).toBeNull();
    expect(host.querySelector('[data-testid="talk-live"]')).toBeNull();
    expect(host.querySelectorAll(".c-btn:disabled").length).toBe(0);
  });

  it("shows each button, enabled, once its service is ready", async () => {
    const host = await mount({ transcription: true, realtime: true });
    await vi.waitFor(() => expect(host.querySelector('[data-testid="talk-live"]')).not.toBeNull());
    const dictate = host.querySelector<HTMLButtonElement>('[data-testid="dictate"]');
    const live = host.querySelector<HTMLButtonElement>('[data-testid="talk-live"]');
    expect(dictate?.disabled).toBe(false);
    expect(live?.disabled).toBe(false);
    expect(live?.getAttribute("title")).toBe("Talk live with voice");
  });

  it("shows only the button whose service is ready", async () => {
    const host = await mount({ transcription: true, realtime: false });
    await vi.waitFor(() => expect(host.querySelector('[data-testid="dictate"]')).not.toBeNull());
    expect(host.querySelector('[data-testid="talk-live"]')).toBeNull();
  });
});

const run = new Proxy({}, { get: () => () => undefined }) as ConversationMenuRun;
function ctx(talkOff: string | null): ConversationMenuContext {
  return { row: null, isMain: true, trunkName: "Oak", ownTrunk: false, canRemoveTrunk: false, online: true, now: 0, hasReply: true, talkOff, run };
}
const talkRows = (items: MenuItem[]) => items.filter((i) => (i.kind === undefined || i.kind === "item") && i.label === "Talk live");

describe("DA-16 conversation menu Talk live", () => {
  it("leaves Talk live out while no live voice service is ready", () => {
    expect(talkRows(conversationMenuItems(ctx("Off until you choose")))).toEqual([]);
  });

  it("offers an enabled Talk live once one is ready", () => {
    const rows = talkRows(conversationMenuItems(ctx(null)));
    expect(rows).toHaveLength(1);
    expect((rows[0] as { disabled?: unknown }).disabled).toBeFalsy();
  });
});
