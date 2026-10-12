// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import type { Level } from "../../places-nav/level";
import { Checkins, checkItems, everyChoice, hoursChoice, withItem, withoutItem } from "./Checkins";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HASH = "a".repeat(64);
const FX: Record<string, unknown> = {
  "config.get": { hash: "cfg", valid: true, config: { agents: { defaults: { heartbeat: { every: "30m" } } } } },
  "config.patch": { ok: true },
  "agents.list": { defaultId: "main", agents: [{ id: "main", identity: { name: "Sapling" } }] },
  "agents.files.get": { agentId: "main", workspace: "/w", file: { name: "HEARTBEAT.md", path: "/w/HEARTBEAT.md", missing: false, hash: HASH, content: "# Checks\n- New mail\n- Calendar changes\n" } },
  "agents.files.set": { ok: true, agentId: "main", workspace: "/w", file: { name: "HEARTBEAT.md", path: "/w/HEARTBEAT.md", missing: false } },
  "last-heartbeat": { ts: Date.now() - 60000, status: "ok-empty" },
  wake: { ok: true },
};
let root: Root | null = null, host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
async function mount(level: Level = "regular", scopes = ["operator.admin"]) {
  const request = vi.fn(async (method: string) => FX[method] ?? {});
  const engine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes } as WindowEngine;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<Checkins engine={engine} level={level} />); });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return request;
}
const byText = (t: string) => [...host.querySelectorAll("button")].find(b => b.textContent === t) as HTMLButtonElement;
async function click(el: Element) { await act(async () => { (el as HTMLElement).click(); }); await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }

describe("Check-ins", () => {
  it("Check now wakes the default Trunk", async () => {
    const request = await mount();
    await click(byText("Check now"));
    expect(request).toHaveBeenCalledWith("wake", { mode: "now", text: "Check in now.", agentId: "main" });
  });
  it("How often and Which hours patch only heartbeat.every / heartbeat.activeHours", async () => {
    const request = await mount();
    await click(host.querySelector("[aria-label='How often'] [data-value='1h']")!);
    expect(request).toHaveBeenCalledWith("config.patch", { baseHash: "cfg", raw: JSON.stringify({ agents: { defaults: { heartbeat: { every: "1h" } } } }) });
    await click(host.querySelector("[aria-label='Which hours'] [data-value='work']")!);
    expect(request).toHaveBeenCalledWith("config.patch", { baseHash: "cfg", raw: JSON.stringify({ agents: { defaults: { heartbeat: { activeHours: { start: "09:00", end: "17:00" } } } } }) });
    await click(host.querySelector("[aria-label='Which hours'] [data-value='day']")!);
    await click(host.querySelector("[aria-label='How often'] [data-value='0m']")!);
    expect(request).toHaveBeenCalledWith("config.patch", { baseHash: "cfg", raw: JSON.stringify({ agents: { defaults: { heartbeat: { every: "0m" } } } }) });
  });
  it("What it checks reads HEARTBEAT.md and takes an item out with the read hash", async () => {
    const request = await mount();
    expect(host.textContent).toContain("New mail"); expect(host.textContent).toContain("Calendar changes");
    await click(host.querySelector("[aria-label='Take out “New mail”']")!);
    expect(request).toHaveBeenCalledWith("agents.files.set", { agentId: "main", name: "HEARTBEAT.md", content: "# Checks\n- Calendar changes\n", expectedHash: HASH });
  });
  it("shows the last check-in and greys Quiet on weekends and Long goals with their reasons", async () => {
    await mount();
    expect(host.textContent).toContain("Nothing new.");
    const weekend = host.querySelector("[aria-label='Quiet on weekends']") as HTMLButtonElement;
    expect(weekend.disabled).toBe(true); expect(weekend.closest("[title]")?.getAttribute("title") ?? "").toBe("");
    const add = [...host.querySelectorAll(".au-sec button")].find(b => b.textContent === "Add") as HTMLButtonElement;
    expect(add.disabled).toBe(true); expect(add.title).toBe(""); expect(visibleDevNotes(host)).toEqual([]);
  });
  it("levels: the note box from Advanced, Edit as text only at Technical", async () => {
    await mount("regular");
    expect(host.textContent).not.toContain("Leave a note for the next check-in"); expect(byText("Edit as text")).toBeUndefined();
    await act(async () => root!.unmount()); root = null;
    await mount("advanced");
    expect(host.textContent).toContain("Leave a note for the next check-in"); expect(byText("Edit as text")).toBeUndefined();
    await act(async () => root!.unmount()); root = null;
    await mount("technical");
    expect(byText("Edit as text")).toBeTruthy();
  });
  it("list and choice helpers", () => {
    expect(checkItems("intro\n- a\n* b\n- [ ] c\n")).toEqual(["a", "b", "c"]);
    expect(withoutItem("x\n- a\n- b", 1)).toBe("x\n- a");
    expect(withItem("", "a")).toBe("- a\n");
    expect(everyChoice("")).toBe("30m"); expect(everyChoice("60m")).toBe("1h"); expect(everyChoice("0m")).toBe("0m"); expect(everyChoice("45m")).toBe("other");
    expect(hoursChoice({})).toBe("always"); expect(hoursChoice({ start: "08:00", end: "20:00" })).toBe("day"); expect(hoursChoice({ start: "07:00", end: "20:00" })).toBe("other");
  });
});
