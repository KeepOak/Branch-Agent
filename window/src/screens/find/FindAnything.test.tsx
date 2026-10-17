// @vitest-environment jsdom
import { act, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import { PLACES } from "../../places-nav/routes";
import { getToasts } from "../../shell/notify";
import { FIND_EVENT } from "../../thread/FindBar";
import { DEFAULT_TRUNK_WHY } from "../chat/examples-greeting";
import { R1Window } from "../frame/R1Window";
import { EXAMPLES_READY_EVENT, resetTryExamples, tryExamplesState } from "../onboarding/try-examples";
import { FindAnything, r1PaletteRows, type FindAnythingProps } from "./FindAnything";

vi.mock("../chat/ChatView", () => ({ ChatView: ({ name, examplesWhy }: { name: string; examplesWhy?: string }) => <p>{name}{examplesWhy ? <i data-testid="examples-why">{examplesWhy}</i> : null}</p> }));
vi.mock("../composer/Composer", () => ({ Composer: () => <textarea aria-label="Message" /> }));
vi.mock("../../shell/use-status", () => ({ useLimits: () => null }));
vi.mock("../../shell/use-lockdown", () => ({ useLockdown: () => ({ on: false, supported: false, toggle: async () => undefined, confirmation: null }) }));
vi.mock("../../places-nav/PlaceView", () => ({ PlaceView: () => <p>Place content</p> }));
vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../sidebar/Sidebar", () => ({ Sidebar: ({ searchRef }: { searchRef: RefObject<HTMLInputElement | null> }) => <nav><input ref={searchRef} aria-label="Search stub" /></nav> }));
vi.mock("../../places/settings/set1/appearance-store", () => ({ lookStore: () => ({ load: async () => undefined }) }));
vi.mock("../../shell/group-drop", async (real) => ({ ...(await real<object>()), useGroupRooms: () => ({ rooms: [], peerOnline: new Map(), reload: async () => undefined }) }));
vi.mock("../../shell/engine-data", async (load) => ({ ...(await load<typeof import("../../shell/engine-data")>()), useConversations: () => [{ loaded: true, error: null, rows: [] }], usePendingApprovals: () => new Map() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = () => undefined; // jsdom draws no layout
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { resetTryExamples(); await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const wait = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });
const RESPONSES: Record<string, unknown> = {
  "config.get": { hash: "h", config: { wizard: { lastRunAt: "2026-10-01T00:00:00Z" } } },
  "agents.list": { defaultId: "ledger", agents: [{ id: "ledger", identity: { name: "Ledger" } }] },
  "sessions.search": { results: [{ sessionKey: "agent:ledger:quotes", role: "assistant", snippet: "The supplier quote came in at 412 dollars.", timestamp: 5, messageId: "m1" }] },
};
const engineFor = (request: ReturnType<typeof vi.fn>) => ({ request, onEvent: () => () => undefined, agentId: "ledger", sessionKey: "agent:ledger:main", features: { methods: ["sessions.search", "agents.list", "sessions.create", "trunks.template.starters"], events: [] } });

describe("Find anything in the R1 window", () => {
  it("Ctrl K opens Find anything centered over the window, and Escape puts the window back", async () => {
    const snapshot = { status: { phase: "connected" }, name: "Ledger", sessionKey: "agent:ledger:main", mainKey: "agent:ledger:main", history: [], live: [], queued: [] };
    const request = vi.fn(async (method: string) => RESPONSES[method] ?? {});
    const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, request, onGatewayEvent: () => () => undefined, engine: engineFor(request) } as unknown as SaplingSession;
    await act(async () => root.render(<R1Window session={session} />));
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })); });
    await wait(40);
    expect(document.querySelector('[data-testid="palette"]')?.getAttribute("aria-label")).toBe("Find anything");
    expect(document.querySelector(".r1-find [data-testid=\"palette\"]")).not.toBeNull();
    expect(host.querySelector(".palette-scrim")).not.toBeNull();
    expect(host.querySelector(".r1-ob-behind")?.getAttribute("aria-hidden")).toBe("true");
    const input = document.querySelector<HTMLInputElement>('[data-testid="palette"] input')!;
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(document.querySelector('[data-testid="palette"]')).toBeNull();
    expect(host.querySelector(".r1-ob-behind")?.hasAttribute("aria-hidden")).toBe(false);
  });
});

function setupFind() {
  const request = vi.fn(async (method: string) => RESPONSES[method] ?? {});
  const session = { request, getSnapshot: () => ({ sessionKey: "agent:ledger:main" }), onGatewayEvent: () => () => undefined, engine: engineFor(request) } as unknown as SaplingSession;
  const quotes = { key: "agent:ledger:quotes", title: "Supplier quotes", agentId: "ledger", isMain: false, archived: false } as unknown as Conversation;
  const props: FindAnythingProps = {
    session, ready: true, list: { refresh: vi.fn(async () => undefined), getSnapshot: () => ({ rows: [] }) } as unknown as ConversationList,
    conversations: [quotes], lockdownOn: false, onOpenConversation: vi.fn(), onPlace: vi.fn(), onSettings: vi.fn(), onSetup: vi.fn(), onShortcuts: vi.fn(), onClose: vi.fn(),
  };
  return { request, props, render: async () => { await act(async () => root.render(<FindAnything {...props} />)); await wait(0); } };
}
const type = async (value: string) => {
  const input = document.querySelector<HTMLInputElement>('[data-testid="palette"] input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const row = (label: string) => [...document.querySelectorAll<HTMLElement>('[data-testid="palette-row"]')].find(node => node.querySelector(".pal-label")?.textContent === label)!;

describe("Find anything offers Try it with examples", () => {
  it("runs the onboarding starters call and opens Settings › Trunks", async () => {
    const { render, request, props } = setupFind();
    request.mockImplementation(async (method: string) => {
      if (method === "trunks.template.starters") return { offer: [{ id: "home-desk", name: "Home Desk", pitch: "Family admin." }] };
      return RESPONSES[method] ?? {};
    });
    await render();
    await type("examples");
    const hit = row("Try it with examples");
    expect(hit.querySelector(".pal-hint")?.textContent ?? "").not.toBe("Coming");
    await act(async () => hit.click());
    await wait(20);
    expect(request).toHaveBeenCalledWith("trunks.template.starters", {});
    expect(props.onSettings).toHaveBeenCalledWith("trunks");
    expect(tryExamplesState()).toEqual({ status: "ready", examples: [{ id: "home-desk", name: "Home Desk", pitch: "Family admin." }] });
  });

  it("opens that conversation with the examples greeting", async () => {
    const snapshot = { status: { phase: "connected" }, name: "Ledger", sessionKey: "agent:ledger:main", mainKey: "agent:ledger:main", history: [], live: [], queued: [] };
    const request = vi.fn(async (method: string) => RESPONSES[method] ?? {});
    const session = { subscribe: () => () => undefined, getSnapshot: () => snapshot, request, onGatewayEvent: () => () => undefined, open: vi.fn(async () => undefined), send: vi.fn(), engine: engineFor(request) } as unknown as SaplingSession;
    await act(async () => root.render(<R1Window session={session} />));
    await wait(40);
    await act(async () => { window.dispatchEvent(new CustomEvent(EXAMPLES_READY_EVENT, { detail: { sessionKey: "agent:ledger:main" } })); });
    expect(document.querySelector("[data-testid=examples-why]")?.textContent).toBe(DEFAULT_TRUNK_WHY);
  });
});

describe("FindAnything (the Classic palette re-hosted)", () => {
  it("lists the Classic actions and says Coming for the commands R1 has no home for", async () => {
    const { render } = setupFind();
    await render();
    expect(row("New conversation").querySelector(".pal-hint")?.textContent).toBe("Ctrl N");
    await type("focus");
    const focus = row("Focus mode");
    expect(focus.querySelector(".pal-hint")?.textContent).toBe("Coming");
    await act(async () => focus.click());
    expect(getToasts().map(toast => toast.text)).toContain("Coming · Focus mode comes in a later update.");
  });

  it("opens places, Settings pages and conversations through the R1 routes", async () => {
    const { render, props } = setupFind();
    await render();
    await act(async () => row(PLACES[0].name).click());
    expect(props.onPlace).toHaveBeenCalledWith(PLACES[0].id);
    expect(props.onClose).toHaveBeenCalled();
    await act(async () => row("Supplier quotes").click());
    expect(props.onOpenConversation).toHaveBeenCalledWith("agent:ledger:quotes");
  });

  it("lists message hits from sessions.search and opens one with find asked for the words", async () => {
    const { render, props, request } = setupFind();
    await render();
    await type("quote");
    await wait(260);
    expect(request).toHaveBeenCalledWith("sessions.search", expect.objectContaining({ query: "quote", limit: 25 }));
    const asked: (string | undefined)[] = [];
    const listen = (event: Event) => asked.push((event as CustomEvent<{ query?: string }>).detail?.query);
    window.addEventListener(FIND_EVENT, listen);
    await act(async () => row("The supplier quote came in at 412 dollars.").click());
    await wait(5);
    window.removeEventListener(FIND_EVENT, listen);
    expect(props.onOpenConversation).toHaveBeenCalledWith("agent:ledger:quotes");
    expect(asked).toEqual(["quote"]);
  });

  it("sends Customize's tab rows to Customize, since the R1 window has no tab event", () => {
    const onPlace = vi.fn();
    const rows = r1PaletteRows([{ id: "p:customize:Skills", group: "Places", label: "Skills", hint: "Customize · Tools", run: () => undefined }], onPlace);
    rows[0].run();
    expect(onPlace).toHaveBeenCalledWith("customize");
  });
});
