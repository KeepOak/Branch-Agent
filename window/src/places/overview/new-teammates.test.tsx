// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { NewTeammates } from "./NewTeammates";
import { cardStatus, teammateCard } from "./teammates";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
const notify = vi.hoisted(() => vi.fn());
vi.mock("../../shell/notify", () => ({ notify }));

const NOW = new Date(2026, 9, 12, 9, 0);
const TOMORROW_630 = new Date(2026, 9, 13, 6, 30).getTime();
const NIGHT = { agentId: "night-shift", name: "Night Shift", title: "Night Shift", summary: "Writes a short digest every weekday at 6:30.", started: false, timezone: "America/New_York", routines: [{ id: "j1", name: "Morning digest", enabled: false }] };

let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; notify.mockReset(); });

async function render(request: (method: string, params?: unknown) => Promise<unknown>) {
  const engine = { request: vi.fn(request), sessionKey: null, scopes: ["operator.admin"], onEvent: vi.fn(() => () => {}) } as unknown as WindowEngine;
  const openConversation = vi.fn();
  const host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root!.render(<NewTeammates engine={engine} mainKey="main" openConversation={openConversation} />));
  await act(async () => { await Promise.resolve(); });
  return { host, engine, openConversation };
}
const button = (host: HTMLElement, label: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === label);

describe("New teammates on Overview", () => {
  it("shows a paused teammate with Start and Open, and starts it only when the owner taps Start", async () => {
    const request = vi.fn(async (method: string) => method === "trunks.template.cards" ? { cards: [NIGHT] } : { card: { ...NIGHT, started: true, nextRunAtMs: TOMORROW_630, routines: [{ id: "j1", name: "Morning digest", enabled: true, nextRunAtMs: TOMORROW_630 }] }, warnings: [] });
    const { host, engine, openConversation } = await render(request);
    expect(host.textContent).toContain("New teammates");
    expect(host.textContent).toContain("Night Shift");
    expect(host.textContent).toContain("Paused until you start it");
    expect(engine.request).toHaveBeenCalledTimes(1);
    expect(button(host, "Stop")).toBeUndefined();

    await act(async () => { button(host, "Start")!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(engine.request).toHaveBeenLastCalledWith("trunks.template.start", { agentId: "night-shift" });
    expect(host.textContent).toContain("Next run");
    expect(button(host, "Start")).toBeUndefined();
    expect(button(host, "Stop")).toBeDefined();

    button(host, "Open")!.click();
    expect(openConversation).toHaveBeenCalledWith("agent:night-shift:main");
  });

  it("stops a started teammate", async () => {
    const started = { ...NIGHT, started: true, nextRunAtMs: TOMORROW_630 };
    const request = vi.fn(async (method: string) => method === "trunks.template.cards" ? { cards: [started] } : { card: { ...NIGHT, started: false }, warnings: [] });
    const { host, engine } = await render(request);
    await act(async () => { button(host, "Stop")!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(engine.request).toHaveBeenLastCalledWith("trunks.template.stop", { agentId: "night-shift" });
    expect(host.textContent).toContain("Paused until you start it");
  });

  it("says why a Start failed", async () => {
    const request = vi.fn(async (method: string) => { if (method === "trunks.template.cards") return { cards: [NIGHT] }; throw new Error("cron is off"); });
    const { host } = await render(request);
    await act(async () => { button(host, "Start")!.click(); });
    await act(async () => { await Promise.resolve(); });
    expect(notify).toHaveBeenCalledWith("Couldn't start Night Shift: cron is off", { tone: "bad" });
  });

  it("shows nothing when there are no new teammates or the engine has no cards method", async () => {
    expect((await render(async () => ({ cards: [] }))).host.textContent).toBe("");
    await act(async () => root?.unmount()); root = undefined;
    expect((await render(async () => { throw new Error("unknown method"); })).host.textContent).toBe("");
  });

  it("words the status from the card", () => {
    expect(cardStatus(teammateCard({ ...NIGHT, started: true, nextRunAtMs: TOMORROW_630 }), NOW)).toBe("Next run Tomorrow, 6:30 AM");
    expect(cardStatus(teammateCard({ ...NIGHT, routines: [], started: true }), NOW)).toBe("Runs when you message it");
  });
});
