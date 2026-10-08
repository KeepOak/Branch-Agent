// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GROUP_REASONS, NewGroupChat, openNewGroupChat, readChoices, readGroupPrefill, startGroupChat, type GroupProgress } from "./NewGroupChat";
import type { WindowEngine } from "../connect/engine";
import { useShellRoom, type ShellRoom } from "./useShellRoom";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

// Shapes from gateway-protocol schema/users.ts (UserProfile), agents.list and the a2a channel config.
const responses: Record<string, unknown> = {
  "agents.list": { defaultId: "main", agents: [{ id: "main", identity: { name: "Oak" } }, { id: "birch", identity: { name: "Birch" } }] },
  "users.list": { profiles: [{ id: "p-me", displayName: "Me", mergedInto: null }, { id: "p-2", displayName: "Rowan", mergedInto: null }] },
  "users.self": { profile: { id: "p-me" } },
  "config.get": { config: { channels: { a2a: { peers: { helper: { token: "x", url: "https://h.example" } } } } } },
  "sessions.create": { ok: true, key: "agent:birch:new" },
  "session.members.add": { ok: true },
};

describe("New group chat", () => {
  it("renders a brand-new group before its lead session exists", async () => {
    let shell: ShellRoom | undefined;
    function Harness() {
      shell = useShellRoom({ engine: undefined, rowKind: undefined, agentId: undefined, title: "Plan", ownTrunk: "Scout", history: [], trunks: [],
        groupRoom: { roomId: "fresh", rule: "mentions", members: [{ kind: "trunk", id: "scout" }, { kind: "a2a", id: "ledger" }] },
        memberName: (_kind, id) => ({ scout: "Scout", ledger: "Ledger" } as Record<string, string>)[id] ?? id });
      return <>{shell.header?.faces(34)}<span>{shell.header?.line}</span></>;
    }
    const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
    await act(async () => root!.render(<Harness />));
    expect(shell?.thread.isRoom).toBe(true);
    expect(shell?.header).not.toBeNull();
    expect(shell?.menu?.ruleWords).toBe("mentions only");
    expect(host.textContent).toContain("Scout, Ledger and you");
  });
  it("retries a failed member on the created conversation, retaining completed members", async () => {
    let fail = true;
    const request = vi.fn(async (method: string, params: unknown) => {
      if (method === "sessions.create") return { key: "agent:main:one" };
      if ((params as { identityId: string }).identityId === "p-3" && fail) {
        fail = false;
        throw new Error("temporarily unavailable");
      }
      return { ok: true };
    });
    const engine = { request } as unknown as WindowEngine;
    const progress: GroupProgress = { key: null, added: new Set() };
    const params = { name: "September", trunk: "main", people: ["p-2", "p-3"] };
    await expect(startGroupChat(engine, params, progress)).rejects.toThrow("temporarily unavailable");
    await expect(startGroupChat(engine, params, progress)).resolves.toBe("agent:main:one");
    expect(request.mock.calls.filter(([m]) => m === "sessions.create")).toHaveLength(1);
    expect(request.mock.calls.filter(([m, p]) => m === "session.members.add" && (p as { identityId: string }).identityId === "p-2")).toHaveLength(1);
    expect(request.mock.calls.filter(([m, p]) => m === "session.members.add" && (p as { identityId: string }).identityId === "p-3")).toHaveLength(2);
  });

  it("does not add members or return an empty key after an incomplete create response", async () => {
    const request = vi.fn(async () => ({ ok: true }));
    const engine = { request } as unknown as WindowEngine;
    await expect(startGroupChat(engine, { name: "", trunk: "main", people: ["p-2"] })).rejects.toThrow("conversation's key");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("reads the Trunks, the other people and the A2A peers", () => {
    const c = readChoices(responses["agents.list"], responses["users.list"], responses["users.self"], responses["config.get"]);
    expect(c.trunks.map((t) => t.name)).toEqual(["Oak", "Birch"]);
    expect(c.people).toEqual([{ id: "p-2", name: "Rowan" }]);
    expect(c.peers).toEqual([{ id: "helper", name: "helper" }]);
  });

  it("opens with both dropped chats already filled in", async () => {
    const request = vi.fn(async (method: string) => responses[method]);
    const engine = { request, onEvent: () => () => undefined, sessionKey: null, scopes: [] } as unknown as WindowEngine;
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<NewGroupChat engine={engine} onClose={() => {}} onOpen={() => {}} prefill={{ name: "Scout and Ledger", trunk: "birch", people: ["p-2"] }} />));
    await act(async () => undefined);
    expect(document.querySelector<HTMLInputElement>(".rm-fld input")?.value).toBe("Scout and Ledger");
    const chip = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".rm-chip")].find((b) => b.textContent === label)!;
    expect(chip("Birch").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Oak").getAttribute("aria-pressed")).toBe("false");
    expect(chip("Rowan").getAttribute("aria-pressed")).toBe("true");
    const event = new CustomEvent("branch:new-group-chat", { detail: { name: "Scout and Ledger", trunk: "birch", people: ["p-2"] } });
    expect(readGroupPrefill(event)).toEqual({ name: "Scout and Ledger", trunk: "birch", people: ["p-2"] });
    const heard: unknown[] = [];
    const onEvent = (next: Event) => heard.push((next as CustomEvent).detail);
    window.addEventListener("branch:new-group-chat", onEvent);
    openNewGroupChat({ name: "Scout and Ledger", trunk: "birch", people: ["p-2"] });
    expect(heard).toEqual([{ name: "Scout and Ledger", trunk: "birch", people: ["p-2"] }]);
    window.removeEventListener("branch:new-group-chat", onEvent);
  });
  it("makes the conversation with the chosen Trunk, adds each person, and opens it", async () => {
    const request = vi.fn(async (method: string) => responses[method]);
    const engine = { request, onEvent: () => () => undefined, sessionKey: null, scopes: [] } as unknown as WindowEngine;
    const onOpen = vi.fn(), onClose = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root!.render(<NewGroupChat engine={engine} onClose={onClose} onOpen={onOpen} />));
    await act(async () => undefined);
    const chip = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".rm-chip")].find((b) => b.textContent === label)!;
    expect(document.body.textContent).toContain(GROUP_REASONS.secondTrunk);
    await act(async () => chip("Birch").click());
    expect(chip("Birch").getAttribute("aria-pressed")).toBe("true");
    expect(chip("Oak").getAttribute("aria-pressed")).toBe("false");
    expect(chip("helper").disabled).toBe(true);
    await act(async () => chip("Rowan").click());
    const name = document.querySelector<HTMLInputElement>(".rm-fld input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Close the month");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const start = [...document.querySelectorAll("button")].find((b) => b.textContent === "Start the group chat")!;
    await act(async () => start.click());
    expect(request).toHaveBeenCalledWith("sessions.create", { agentId: "birch", label: "Close the month" });
    expect(request).toHaveBeenCalledWith("session.members.add", { sessionKey: "agent:birch:new", agentId: "birch", identityId: "p-2" });
    expect(onOpen).toHaveBeenCalledWith("agent:birch:new");
    expect(onClose).toHaveBeenCalled();
  });
});
