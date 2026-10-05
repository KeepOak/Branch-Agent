// @vitest-environment jsdom
// P46: the Trunk rows' running rings and the status bar's "N running" come from the engine's live run
// registry. A reconnect (restart or in-place update) clears every ring at once; the new engine's lists
// then light up only what really runs.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Contact } from "@branch/gateway-protocol";
import type { SaplingSession } from "../connect/session";
import { ConversationRow } from "./ConversationRow";
import { contactRow, projectContact } from "./contacts-model";
import { useContacts, useConversations } from "./engine-data";

vi.mock("../face/Pebble", () => ({ Pebble: () => null }));
vi.mock("../connect/gateway", () => ({ BranchGateway: class {} }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

const contact = (id: string, name: string, working: boolean): Contact => ({
  id: `trunk:${id}`, kind: "trunk", name, threadKey: `agent:${id}:main`, isDefault: id === "oak",
  lastActivityAt: 1, preview: { kind: "message", text: "", at: 1 }, unreadTopics: 0, threadUnread: false,
  needsYou: false, working, topicCount: 0,
} as Contact);
const session = (id: string, working: boolean) => ({ key: `agent:${id}:main`, agentId: id, hasActiveRun: working, updatedAt: 1 });

/** A fake engine: what it reports now, and a gate that holds its answers like a slow first read. */
function fakeEngine(running: string[]) {
  const engine = { running, gate: Promise.resolve() as Promise<void> };
  const request = vi.fn(async (method: string) => {
    await engine.gate;
    if (method === "contacts.list") return { contacts: [contact("oak", "Oak", engine.running.includes("oak")), contact("elm", "Elm", engine.running.includes("elm"))] };
    if (method === "sessions.subscribe" || method === "sessions.list") {
      const sessions = [session("oak", engine.running.includes("oak")), session("elm", engine.running.includes("elm"))];
      return method === "sessions.list" ? { sessions } : { list: { sessions } };
    }
    return {};
  });
  const sapling = { request, onGatewayEvent: () => () => undefined, getSnapshot: () => ({ sessionKey: null }) } as unknown as SaplingSession;
  return { engine, sapling };
}

function Shell({ sapling, ready }: { sapling: SaplingSession; ready: boolean }) {
  const [lists] = useConversations(sapling, ready, null);
  const [contacts] = useContacts(sapling, ready);
  const rows = projectContact(contacts, lists.rows).map(contactRow);
  return (
    <div>
      <span data-testid="running">{lists.rows.filter((r) => r.working).length} running</span>
      {rows.map((row) => (
        <ConversationRow key={row.key} row={row} current={false} time="" showPreview={false} state={{ waiting: false, working: row.working }}
          trunkName={row.title} onOpen={() => undefined} onMenu={() => undefined} />
      ))}
    </div>
  );
}

const rings = (container: HTMLElement) => [...container.querySelectorAll("[data-working=true]")].map((el) => el.closest(".row")?.textContent ?? "");
const running = (container: HTMLElement) => container.querySelector("[data-testid=running]")?.textContent;

describe("running state after a reconnect", () => {
  it("clears every ring on a new hello, then shows only the Trunk the engine reports running", async () => {
    const { engine, sapling } = fakeEngine(["oak", "elm"]);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root!.render(<Shell sapling={sapling} ready />));
    expect(rings(container)).toHaveLength(2);
    expect(running(container)).toBe("2 running");

    // The engine restarts: the window loses the connection, then gets a new hello. The new engine's
    // first answers are slow; until they land nothing may claim to run.
    let answer!: () => void;
    engine.gate = new Promise((resolve) => { answer = resolve; });
    engine.running = ["elm"];
    await act(async () => root!.render(<Shell sapling={sapling} ready={false} />));
    await act(async () => root!.render(<Shell sapling={sapling} ready />));
    expect(container.querySelectorAll(".row").length).toBe(2);
    expect(rings(container)).toEqual([]);
    expect(running(container)).toBe("0 running");

    await act(async () => { answer(); await engine.gate; });
    expect(rings(container)).toHaveLength(1);
    expect(rings(container)[0]).toContain("Elm");
    expect(running(container)).toBe("1 running");
  });
});
