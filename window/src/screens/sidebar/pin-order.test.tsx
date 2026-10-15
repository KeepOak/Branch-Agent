// @vitest-environment jsdom
// Private #974, R1 parity row 9: the Pinned order (Classic shell/use-pin-order.ts and the pointer drag in
// shell/sidebar-drag.ts) re-hosted in the R1 Pinned grid. The grid follows the saved order, a dragged tile saves the new
// order through users.prefs.set, and the default Trunk stays first and doesn't move.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { ConversationList } from "../../connect/conversations";
import type { SaplingSession } from "../../connect/session";
import type { SideRow } from "./model";
import { orderPins, pinAxis } from "./pin-order";
import { Sidebar, type SidebarProps } from "./Sidebar";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span data-face={label} /> }));
vi.mock("../../shell/use-status", () => ({ useUpdate: () => null }));
vi.mock("../../connect/branch-version", async (load) => ({ ...(await load<typeof import("../../connect/branch-version")>()), useBranchVersion: () => "0.4.4" }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.assign(HTMLElement.prototype, { setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const contact = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, kind: "trunk", name, threadKey: `agent:${id.split(":")[1]}:main`, isDefault: false, lastActivityAt: 10, pinnedAt: 5,
  preview: { kind: "message", text: `${name} says hi`, at: 10 }, unreadTopics: 0, threadUnread: false, needsYou: false, working: false, topicCount: 0, ...extra,
});
const PIN_KEY = "ui.window.contactPinOrder";

async function render(saved: string[]) {
  const data: Record<string, unknown> = {
    "contacts.list": { contacts: [contact("trunk:sapling", "Sapling", { isDefault: true }), contact("trunk:ledger", "Ledger"), contact("trunk:scout", "Scout"), contact("trunk:quill", "Quill")] },
    "agents.list": { defaultId: "sapling", agents: ["sapling", "ledger", "scout", "quill"].map(id => ({ id, identity: { name: id } })) },
    "rooms.list": { rooms: [] }, "a2a.peers.list": { peers: [] },
    "users.self": { profile: { id: "me", displayName: "Taofik" } }, "users.list": { profiles: [] },
    "users.prefs.get": { status: "ok", entries: { [PIN_KEY]: saved } },
    "users.prefs.set": { status: "ok" },
  };
  const request = vi.fn(async (method: string) => data[method] ?? {});
  const engine = { request, scopes: ["operator.admin"], features: { methods: Object.keys(data), events: [] } };
  const session = { request, onGatewayEvent: () => () => undefined, engine, gatewayUrl: "ws://127.0.0.1:1", open: vi.fn(async () => undefined), send: vi.fn() } as unknown as SaplingSession;
  const props: SidebarProps = {
    onNewTrunk: vi.fn(), session, ready: true, list: { refresh: vi.fn(async () => undefined), getSnapshot: () => ({ rows: [] }) } as unknown as ConversationList,
    sessions: [], mainKey: "main", currentKey: null, waiting: new Map(), searchRef: { current: null }, onOpen: vi.fn(), onSettings: vi.fn(), onPlace: vi.fn(),
  };
  await act(async () => root.render(<CapabilityProvider engine={engine}><Sidebar {...props} /></CapabilityProvider>));
  await act(async () => undefined);
  await act(async () => undefined);
  return { request, onOpen: props.onOpen };
}
const tiles = () => [...host.querySelectorAll<HTMLElement>(".r1sb-pins [data-pin]")].map(tile => tile.dataset.pin);
const tile = (id: string) => host.querySelector<HTMLElement>(`.r1sb-pins [data-pin="${id}"] .r1sb-pin-open`)!;
const pointer = (type: string, x: number, y = 10) => Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }), { pointerId: 1, pointerType: "mouse" });

async function drag(from: string, to: string) {
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  document.elementFromPoint = () => tile(to);
  await act(async () => { tile(from).dispatchEvent(pointer("pointerdown", 0)); });
  await act(async () => { tile(from).dispatchEvent(pointer("pointermove", 60)); });
  await act(async () => { tile(from).dispatchEvent(pointer("pointerup", 60)); });
}

describe("R1 Pinned order (Classic use-pin-order re-hosted)", () => {
  it("lays the Pinned grid out in the saved order, the default first", async () => {
    await render(["agent:quill:main", "agent:ledger:main", "agent:scout:main"]);
    expect(tiles()).toEqual(["agent:sapling:main", "agent:quill:main", "agent:ledger:main", "agent:scout:main"]);
  });

  it("saves the new order through users.prefs.set when a tile is dragged, and doesn't open it", async () => {
    const { request, onOpen } = await render(["agent:ledger:main", "agent:scout:main", "agent:quill:main"]);
    await drag("agent:quill:main", "agent:ledger:main");
    expect(request).toHaveBeenCalledWith("users.prefs.set", { entries: { [PIN_KEY]: ["agent:ledger:main", "agent:quill:main", "agent:scout:main"] } });
    expect(tiles()).toEqual(["agent:sapling:main", "agent:ledger:main", "agent:quill:main", "agent:scout:main"]);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("keeps the default Trunk first: it doesn't drag, and nothing drops before it", async () => {
    const { request } = await render(["agent:ledger:main", "agent:scout:main", "agent:quill:main"]);
    await drag("agent:sapling:main", "agent:scout:main");
    await drag("agent:quill:main", "agent:sapling:main");
    expect(request).not.toHaveBeenCalledWith("users.prefs.set", expect.anything());
    expect(tiles()[0]).toBe("agent:sapling:main");
  });

  it("orders pins the saved order doesn't name after the ones it does", () => {
    const row = (id: string, isDefault = false) => ({ id, isDefault } as SideRow);
    expect(orderPins([row("a"), row("b"), row("home", true), row("c")], ["c", "a"]).map(pin => pin.id)).toEqual(["home", "c", "a", "b"]);
  });

  it("names pins by conversation key, so an order Classic saved still applies and a drag saves keys Classic reads", async () => {
    const { request } = await render(["agent:scout:main", "trunk:ledger", "agent:quill:main"]);
    expect(tiles()).toEqual(["agent:sapling:main", "agent:scout:main", "agent:quill:main", "agent:ledger:main"]);
    await drag("agent:ledger:main", "agent:scout:main");
    expect(request).toHaveBeenCalledWith("users.prefs.set", { entries: { [PIN_KEY]: ["agent:scout:main", "agent:ledger:main", "agent:quill:main"] } });
  });

  it("reads before and after by height when the collapsed rail stacks the pins in one column", () => {
    const grid = document.body.appendChild(document.createElement("div"));
    expect(pinAxis(null)).toBe("x");
    grid.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    expect(pinAxis(grid)).toBe("x");
    grid.style.gridTemplateColumns = "1fr";
    expect(pinAxis(grid)).toBe("y");
  });

  it("drops above a pin in the rail when the pointer moves up over its top half", async () => {
    const { request } = await render(["agent:ledger:main", "agent:scout:main", "agent:quill:main"]);
    host.querySelector<HTMLElement>(".r1sb-pins")!.style.gridTemplateColumns = "1fr";
    for (const [index, tile] of [...host.querySelectorAll<HTMLElement>(".r1sb-pins [data-pin]")].entries()) {
      tile.getBoundingClientRect = () => ({ left: 0, right: 52, width: 52, top: index * 60, bottom: index * 60 + 52, height: 52, x: 0, y: index * 60, toJSON() {} }) as DOMRect;
    }
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    document.elementFromPoint = () => tile("agent:ledger:main");
    const from = tile("agent:quill:main");
    await act(async () => { from.dispatchEvent(pointer("pointerdown", 26, 200)); });
    await act(async () => { from.dispatchEvent(pointer("pointermove", 26, 70)); });
    await act(async () => { from.dispatchEvent(pointer("pointerup", 26, 70)); });
    expect(request).toHaveBeenCalledWith("users.prefs.set", { entries: { [PIN_KEY]: ["agent:quill:main", "agent:ledger:main", "agent:scout:main"] } });
  });
});
