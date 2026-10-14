// @vitest-environment jsdom
// #977: the message menu's Pin and Delete call sessions.messages.pin and sessions.messages.delete through <Coming need>.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { historyToBlocks } from "../../thread/history";
import type { Block } from "../../thread/model";
import { ChatView } from "./ChatView";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label: string }) => <span data-face={label} /> }));
vi.mock("../../composer/useConversation", () => ({ useConversation: () => ({ loaded: false }), hasNoModel: () => true }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const BASE = ["chat.send", "session.reactions.set", "sessions.rewind", "sessions.fork", "session.context.set", "talk.speak"];
const MESSAGES = ["sessions.messages.pin", "sessions.messages.delete"];
const engineWith = (methods: string[]) => ({ request: vi.fn(async (_method: string, _params?: unknown) => ({})), onEvent: () => () => undefined, sessionKey: "agent:scout:main", agentId: "scout", scopes: ["operator.admin"], features: { methods, events: [] } });
const history: Block[] = [
  { kind: "user", key: "u1", text: "Find the Hartwell invoice from August.", meta: { entryId: "e1", timestamp: 1 } },
  { kind: "text", key: "a1", text: "It is in Outlook, from 14 August.", streaming: false, meta: { entryId: "e2", timestamp: 2 } },
];

async function show(engine: ReturnType<typeof engineWith>, blocks = history, onReload = vi.fn()) {
  const view = <ChatView name="Scout" history={blocks} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} engine={engine as unknown as WindowEngine} sessionKey={engine.sessionKey} onReload={onReload} onToast={() => undefined} />;
  await act(async () => root.render(<CapabilityProvider engine={engine as unknown as WindowEngine}>{view}</CapabilityProvider>));
  return onReload;
}
const reply = () => host.querySelector<HTMLElement>('[data-entry="e2"]');
async function openMenu() {
  const bars = host.querySelectorAll<HTMLElement>('[data-testid="hover-bar"]');
  await act(async () => bars[1].querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
}
const row = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]')].find((b) => b.textContent === label);

it("Pin calls sessions.messages.pin, shows the pinned mark, and the row turns to Unpin", async () => {
  const engine = engineWith([...BASE, ...MESSAGES]);
  const onReload = await show(engine);
  expect(host.querySelector('[data-testid="pinned-mark"]')).toBeNull();
  await openMenu();
  expect(row("Pin")!.dataset.need).toBe("sessions.messages.pin");
  expect(row("Pin")!.getAttribute("aria-disabled")).toBeNull();
  await act(async () => row("Pin")!.click());
  expect(engine.request).toHaveBeenCalledWith("sessions.messages.pin", { sessionKey: "agent:scout:main", agentId: "scout", messageId: "e2", pinned: true });
  expect(onReload).toHaveBeenCalled();
  expect(host.querySelectorAll('[data-testid="pinned-mark"]')).toHaveLength(1);
  expect(host.querySelector('[data-pinned] [data-entry="e2"]')).not.toBeNull();
  await openMenu();
  expect(row("Pin")).toBeUndefined();
  await act(async () => row("Unpin")!.click());
  expect(engine.request).toHaveBeenLastCalledWith("sessions.messages.pin", expect.objectContaining({ messageId: "e2", pinned: false }));
  expect(host.querySelector('[data-testid="pinned-mark"]')).toBeNull();
});

it("a message the engine returns pinned shows the mark and offers Unpin", async () => {
  const blocks = historyToBlocks([
    { role: "user", content: "hi", __branch: { id: "e1" } },
    { role: "assistant", content: [{ type: "text", text: "Hello." }], pinned: true, __branch: { id: "e2" } },
  ], [], "agent:scout:main", null);
  expect(blocks.find((b) => b.kind === "text")?.meta?.pinned).toBe(true);
  await show(engineWith([...BASE, ...MESSAGES]), blocks);
  expect(host.querySelectorAll('[data-testid="pinned-mark"]')).toHaveLength(1);
  await openMenu();
  expect(row("Unpin")).toBeDefined();
});

it("Delete asks first, calls sessions.messages.delete, and the message disappears", async () => {
  const engine = engineWith([...BASE, ...MESSAGES]);
  await show(engine);
  expect(reply()).not.toBeNull();
  await openMenu();
  expect(row("Delete")!.dataset.need).toBe("sessions.messages.delete");
  expect(row("Delete")!.dataset.danger).toBe("true");
  await act(async () => row("Delete")!.click());
  const dialog = document.querySelector('[data-testid="delete-dialog"]')!;
  expect(dialog).not.toBeNull();
  expect(engine.request).not.toHaveBeenCalledWith("sessions.messages.delete", expect.anything());
  await act(async () => dialog.querySelector<HTMLButtonElement>('[data-action="confirm-delete"]')!.click());
  expect(engine.request).toHaveBeenCalledWith("sessions.messages.delete", { sessionKey: "agent:scout:main", agentId: "scout", messageId: "e2" });
  expect(document.querySelector('[data-testid="delete-dialog"]')).toBeNull();
  expect(reply()).toBeNull();
  expect(host.querySelector('[data-entry="e1"]')).not.toBeNull();
});

it("Cancel in the confirm deletes nothing; a failed delete keeps the message and says why", async () => {
  const engine = engineWith([...BASE, ...MESSAGES]);
  await show(engine);
  await openMenu();
  await act(async () => row("Delete")!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="delete-dialog"] .btn.ghost')!.click());
  expect(engine.request).not.toHaveBeenCalledWith("sessions.messages.delete", expect.anything());
  expect(reply()).not.toBeNull();
  engine.request.mockImplementation(async (method: string) => { if (method === "sessions.messages.delete") throw new Error("message changed; try again"); return {}; });
  await openMenu();
  await act(async () => row("Delete")!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[data-action="confirm-delete"]')!.click());
  expect(document.querySelector('[data-testid="delete-dialog"]')!.textContent).toContain("message changed; try again");
  expect(reply()).not.toBeNull();
});

it("on an engine without them, Pin and Delete show Coming and call nothing", async () => {
  const engine = engineWith(BASE);
  await show(engine);
  await openMenu();
  for (const label of ["Pin", "Delete"]) {
    expect(row(label)!.getAttribute("aria-disabled"), label).toBe("true");
    expect(row(label)!.dataset.coming, label).toBeTruthy();
    await act(async () => row(label)!.click());
  }
  expect(document.querySelector('[data-testid="delete-dialog"]')).toBeNull();
  expect(engine.request).not.toHaveBeenCalledWith("sessions.messages.pin", expect.anything());
  expect(engine.request).not.toHaveBeenCalledWith("sessions.messages.delete", expect.anything());
});
