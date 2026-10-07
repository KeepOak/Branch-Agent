// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { InboxPlace } from "./index";
import { clock, dayWord } from "../overview/format";

function wakeWords(until: number, now = Date.now()): string {
  const at = new Date(until);
  const day = dayWord(at, new Date(now));
  const time = clock(at);
  return day === "Today" || day === "Tomorrow" ? `Wakes ${day.toLowerCase()} at ${time}` : `Wakes ${day} at ${time}`;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../face/Face", () => ({ Face: ({ label, size }: { label?: string; size: number }) => <span role="img" aria-label={label} data-face-size={size} /> }));

const NOW = Date.now();
const SOON = NOW + 2 * 3_600_000;
const LATER = NOW + 30 * 3_600_000;

type Row = { key: string; agentId: string; label: string; updatedAt: number; snoozedUntil?: number };

function laterSessions(): Row[] {
  return [
    { key: "agent:main:active", agentId: "main", label: "Active work", updatedAt: NOW },
    { key: "agent:main:later", agentId: "main", label: "September receipts", snoozedUntil: LATER, updatedAt: NOW - 1 },
    { key: "agent:main:soon", agentId: "main", label: "Lease renewal", snoozedUntil: SOON, updatedAt: NOW - 2 },
    { key: "agent:main:woke", agentId: "main", label: "Already awake", snoozedUntil: NOW - 60_000, updatedAt: NOW - 3 },
  ];
}

let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

async function render(sessions = laterSessions()) {
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "sessions.list") return { sessions };
    if (method === "sessions.patch") {
      const patch = params as { key: string; snoozedUntil: number | null };
      const found = sessions.find(s => s.key === patch.key);
      if (found) {
        if (patch.snoozedUntil === null) delete found.snoozedUntil;
        else found.snoozedUntil = patch.snoozedUntil;
      }
      return { ok: true };
    }
    if (method === "agents.list") return { defaultId: "main", mainKey: "home", agents: [{ id: "main", identity: { name: "Rowan" } }] };
    return {};
  });
  const openConversation = vi.fn();
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(<InboxPlace engine={{ request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] }} facts={{ running: 0, waiting: 0 }} level="regular" openConversation={openConversation} openPlace={vi.fn()} openSettings={vi.fn()} />));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return { host, request, openConversation };
}

const tab = (host: ParentNode, name: string) => [...host.querySelectorAll<HTMLButtonElement>("[role=tab]")].find(b => (b.textContent ?? "").startsWith(name));
const click = async (b: HTMLElement | undefined) => { await act(async () => { b!.click(); await new Promise(r => setTimeout(r, 0)); }); };
const row = (host: ParentNode, title: string) => [...host.querySelectorAll(".ib-row")].find(r => r.textContent?.includes(title));

describe("Inbox › Later", () => {
  it("lists snoozed conversations soonest first with wake words and the tab count", async () => {
    const { host, openConversation } = await render();
    expect(tab(host, "Later")?.textContent).toBe("Later2");
    await click(tab(host, "Later"));
    expect([...host.querySelectorAll(".ib-list .ib-row b")].map(el => el.textContent)).toEqual(["Lease renewal", "September receipts"]);
    expect(host.textContent).toContain(wakeWords(SOON));
    expect(host.textContent).toContain(wakeWords(LATER));
    expect(host.textContent).not.toContain("Active work");
    expect(host.textContent).not.toContain("Already awake");
    expect(host.textContent).not.toContain("Nothing is waiting to finish later.");
    await click([...row(host, "Lease renewal")!.querySelectorAll("button")].find(b => b.textContent === "Open"));
    expect(openConversation).toHaveBeenCalledWith("agent:main:soon");
  });

  it("Wake now calls sessions.patch with snoozedUntil null and removes the row", async () => {
    const { host, request } = await render();
    await click(tab(host, "Later"));
    await click([...row(host, "Lease renewal")!.querySelectorAll("button")].find(b => b.textContent === "Wake now"));
    expect(request.mock.calls.filter(([method]) => method === "sessions.patch").map(([, params]) => params)).toEqual([
      { key: "agent:main:soon", agentId: "main", snoozedUntil: null },
    ]);
    expect(host.textContent).toContain("Woke now.");
    expect(row(host, "Lease renewal")).toBeUndefined();
    expect(row(host, "September receipts")).toBeTruthy();
    expect(tab(host, "Later")?.textContent).toBe("Later1");
  });

  it("shows the empty line when nothing is snoozed", async () => {
    const { host } = await render([
      { key: "agent:main:active", agentId: "main", label: "Active work", updatedAt: NOW },
      { key: "agent:main:woke", agentId: "main", label: "Already awake", snoozedUntil: NOW - 60_000, updatedAt: NOW - 3 },
    ]);
    expect(tab(host, "Later")?.textContent).toBe("Later");
    await click(tab(host, "Later"));
    expect(host.textContent).toContain("Nothing is waiting to finish later.");
    expect(host.querySelector(".ib-list")).toBeNull();
  });
});
