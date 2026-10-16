// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Conversation } from "../../connect/conversations";
import type { RunEnd, SaplingSession } from "../../connect/session";
import type { Block } from "../../thread/model";

const chips = vi.hoisted(() => ({ props: null as null | { onStartTopic: (params: Record<string, unknown>) => void; trunkName: string } }));
const notes = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("../../thread/WhereChips", () => ({
  WhereChips: (p: { onStartTopic: (params: Record<string, unknown>) => void; trunkName: string }) => { chips.props = p; return <div data-testid="where-chips">Where it works</div>; },
}));
vi.mock("../../face/Face", () => ({ Face: ({ label }: { label: string }) => <span data-testid="face">{label}</span> }));
vi.mock("../../shell/notify", () => ({ notify: (...args: unknown[]) => { notes.calls.push(args); } }));

import { startWhere, ThreadExtras } from "./ThreadExtras";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const row = (patch: Partial<Conversation> = {}): Conversation => ({
  key: "agent:ledger:t1", title: "Month-end", agentId: "ledger", isMain: false, pinned: false, archived: false, unread: false, snoozedUntil: null,
  createdAt: 1, updatedAt: 1, preview: "", working: false, kind: "direct", system: false, automation: false, totalTokens: 0, contextTokens: 0, ...patch,
});
const history: Block[] = [];
let root: Root, host: HTMLDivElement;
beforeEach(() => { chips.props = null; notes.calls = []; host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

function session(request: (method: string, params?: unknown) => Promise<unknown>): SaplingSession {
  return { request, engine: {} } as unknown as SaplingSession;
}
const draw = (p: { ended?: RunEnd | null; empty?: boolean; ready?: boolean; value?: Conversation | null; request?: (m: string, p?: unknown) => Promise<unknown>; onOpen?: (key: string) => void }) =>
  act(async () => root.render(<ThreadExtras session={session(p.request ?? (async () => ({})))} ready={p.ready ?? true} name="Ledger" row={p.value === undefined ? row() : p.value}
    history={history} ended={p.ended ?? null} empty={p.empty ?? false} onOpen={p.onOpen ?? (() => {})} />));

it("cheers over the composer when the Trunk's run ends done, and not for a stopped run or in a room", async () => {
  await draw({});
  expect(host.querySelector("[data-testid='done-cheer']")).toBeNull();
  await draw({ ended: { runId: "r1", outcome: "done", at: 2 } });
  const cheer = host.querySelector(".r1-thread-extras .r1-cheer [data-testid='done-cheer']");
  expect(cheer?.textContent).toContain("Ledger is done");
  expect(cheer?.getAttribute("role")).toBe("status");

  await act(async () => root.unmount());
  root = createRoot(host);
  await draw({});
  await draw({ ended: { runId: "r2", outcome: "stopped", at: 3 } });
  expect(host.querySelector("[data-testid='done-cheer']")).toBeNull();

  await act(async () => root.unmount());
  root = createRoot(host);
  await draw({ value: row({ groupChat: true } as Partial<Conversation>) });
  await draw({ value: row({ groupChat: true } as Partial<Conversation>), ended: { runId: "r3", outcome: "done", at: 4 } });
  expect(host.querySelector("[data-testid='done-cheer']")).toBeNull();
});

it("shows Where it works only on an empty conversation of a connected engine, on clear glass", async () => {
  await draw({ empty: false });
  expect(host.querySelector("[data-testid='where-chips']")).toBeNull();
  await draw({ empty: true, ready: false });
  expect(host.querySelector("[data-testid='where-chips']")).toBeNull();
  await draw({ empty: true });
  expect(host.querySelector(".r1-where.g-clear [data-testid='where-chips']")).not.toBeNull();
  expect(chips.props?.trunkName).toBe("Ledger");
});

it("starts a conversation where the chips say through sessions.create and opens it", async () => {
  const request = vi.fn(async () => ({ key: "agent:ledger:new" }));
  const onOpen = vi.fn();
  await draw({ empty: true, request, onOpen });
  await act(async () => { chips.props!.onStartTopic({ cwd: "/work/books" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(request).toHaveBeenCalledWith("sessions.create", { agentId: "ledger", cwd: "/work/books" });
  expect(onOpen).toHaveBeenCalledWith("agent:ledger:new");
  expect(notes.calls).toEqual([]);
});

it("says so when the engine refuses or returns no conversation", async () => {
  const failing = vi.fn(async () => { throw new Error("no such folder"); });
  await draw({ empty: true, request: failing });
  await act(async () => { chips.props!.onStartTopic({ cwd: "/nope" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(String(notes.calls[0]?.[0])).toBe("Couldn't start it there: no such folder");
  expect(await startWhere(session(async () => ({})), undefined, { worktree: true })).toBeNull();
  expect(await startWhere(session(async () => ({ sessionKey: "agent:main:x" })), undefined, {})).toBe("agent:main:x");
});
