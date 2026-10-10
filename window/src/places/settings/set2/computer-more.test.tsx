// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../../../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsPage } from "../index";

type Answers = Record<string, unknown | ((params: Record<string, unknown>) => unknown)>;
function engineWith(answers: Answers) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const a = answers[method];
    if (a === undefined) return {};
    if (a instanceof Error) throw a;
    return typeof a === "function" ? (a as (p: Record<string, unknown>) => unknown)(params) : a;
  });
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] };
  return { engine, request };
}
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); host.className = "set-col"; document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
async function show(engine: WindowEngine, level: "regular" | "advanced" | "technical") {
  await act(async () => root.render(<SettingsPage page="computer" title="Computer & browser" level={level} engine={engine} />));
  await flush();
}
function buttons(text: string): HTMLButtonElement[] {
  return [...document.querySelectorAll("button")].filter((x) => x.textContent?.trim() === text || x.getAttribute("aria-label") === text) as HTMLButtonElement[];
}
async function click(el: HTMLElement) { await act(async () => el.click()); await flush(); }
const row = (title: string) => document.querySelector(`[data-row="${title}"]`) as HTMLElement | null;
const sec = (title: string) => document.querySelector(`[data-sec="${title}"]`) as HTMLElement | null;
const patches = (request: ReturnType<typeof engineWith>["request"]) => request.mock.calls.filter(([m]) => m === "config.patch").map(([, p]) => JSON.parse(String((p as { raw: string }).raw)));

const CONFIG = { "config.get": { hash: "h", valid: true, config: {} }, "config.patch": { ok: true } };
const PAIRED = { pending: [], paired: [{ deviceId: "dev-1", publicKey: "k", displayName: "Desk", platform: "linux", roles: ["node"], scopes: ["node.invoke"], approvedAtMs: 1, createdAtMs: 1, connected: true, tokens: [{ role: "node", scopes: [], createdAtMs: Date.now() }] }] };

describe("Settings › Computer & browser, below Which Trunk uses which", () => {
  it("shows Gateway screen control off until it is enabled in engine config", async () => {
    const { engine, request } = engineWith(CONFIG);
    await show(engine, "regular");
    const screen = row("See the screen and use the mouse")!.querySelector<HTMLInputElement>("input[role=switch]")!;
    expect(screen.checked).toBe(false);
    expect(row("See the screen and use the mouse")!.textContent).toContain("Full access does not turn this on");
    await click(screen);
    expect(patches(request)).toContainEqual({ plugins: { entries: { "cua-computer": { enabled: true } } } });
  });

  it("places the sections by level: Technical-only sections stay out of Advanced", async () => {
    const { engine } = engineWith(CONFIG);
    await show(engine, "regular");
    expect(sec("On a computer")).not.toBeNull();
    expect(sec("Everything connected")).toBeNull();
    await show(engine, "advanced");
    expect(sec("Everything connected")).not.toBeNull();
    expect(sec("Lent computer, technical")).toBeNull();
    await show(engine, "technical");
    expect(sec("Lent computer, technical")).not.toBeNull();
  });

  it("greys a row the engine can't back yet, without its developer note", async () => {
    const { engine } = engineWith(CONFIG);
    await show(engine, "regular");
    const r = row("Ask before a site it hasn’t visited");
    expect(r?.getAttribute("aria-disabled")).toBe("true"); expect(r?.classList.contains("off-k")).toBe(true);
    expect(r?.querySelector(".right")?.hasAttribute("inert")).toBe(true); expect(r?.querySelector<HTMLInputElement>("input[role=switch]")?.disabled).toBe(true);
    expect(r?.textContent).toContain("You say yes once per site."); expect(r?.querySelector(".why-k")).toBeNull();
    expect(visibleDevNotes(document.body)).toEqual([]);
  });

  it("lists paired devices and replaces or revokes an access key", async () => {
    const { engine, request } = engineWith({ ...CONFIG, "device.pair.list": PAIRED, "device.token.rotate": { deviceId: "dev-1", role: "node", scopes: [], rotatedAtMs: 1, tokenDelivery: "withheld-cross-device" }, "device.token.revoke": { ok: true } });
    await show(engine, "technical");
    expect(sec("Everything connected")?.textContent).toContain("Desk");
    await click(buttons("Replace")[0]);
    expect(request).toHaveBeenCalledWith("device.token.rotate", { deviceId: "dev-1", role: "node" });
    expect(document.body.textContent).toContain("the new key is shown only on the device itself");
    await click(buttons("Close")[0]);
    await click(buttons("Revoke")[0]);
    await click(buttons("Revoke").at(-1)!);
    expect(request).toHaveBeenCalledWith("device.token.revoke", { deviceId: "dev-1", role: "node" });
  });

  it("renames a paired device through device.pair.rename", async () => {
    const { engine, request } = engineWith({ ...CONFIG, "device.pair.list": PAIRED });
    await show(engine, "advanced");
    await click(buttons("More for Desk")[0]);
    await click(buttons("Rename…")[0]);
    const input = document.querySelector(".dlg input.inp, [role=dialog] input") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Workbench"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(buttons("Rename").at(-1)!);
    expect(request).toHaveBeenCalledWith("device.pair.rename", { deviceId: "dev-1", label: "Workbench" });
  });

  it("shows the engine's error when the paired list can't be read", async () => {
    const { engine } = engineWith({ ...CONFIG, "device.pair.list": new Error("pairing store unavailable") });
    await show(engine, "advanced");
    expect(sec("Everything connected")?.textContent).toContain("pairing store unavailable");
  });

  it("saves the Logbook switch to the plugin entry and a pairing switch to gateway config", async () => {
    const { engine, request } = engineWith(CONFIG);
    await show(engine, "technical");
    await click(row("Logbook")!.querySelector("input[role=switch]") as HTMLElement);
    await click(row("Allow connections from this computer by themselves")!.querySelector("input[role=switch]") as HTMLElement);
    const sent = patches(request);
    expect(sent).toContainEqual({ plugins: { entries: { logbook: { enabled: true } } } });
    expect(sent).toContainEqual({ gateway: { nodes: { pairing: { autoApproveLocal: false } } } });
  });

  it("Use the camera adds the camera commands to the allowed node commands", async () => {
    const { engine, request } = engineWith(CONFIG);
    await show(engine, "regular");
    await click(row("Use the camera")!.querySelector("input[role=switch]") as HTMLElement);
    expect(patches(request)).toContainEqual({ gateway: { nodes: { commands: { allow: ["camera.snap", "camera.clip"], deny: null } } } });
  });

  it("reads presence for Who is connected now", async () => {
    const { engine } = engineWith({ ...CONFIG, "system-presence": [{ host: "Laptop", platform: "darwin", version: "1.0.0", mode: "ui", reason: "heartbeat", ts: Date.now(), text: "" }] });
    await show(engine, "advanced");
    const who = sec("Who is connected now");
    expect(who?.textContent).toContain("Laptop");
    expect(who?.textContent).toContain("macOS · 1.0.0 · the window");
    expect(who?.textContent).toContain("Active");
  });
  it("cleans up only pairings the engine would treat as superseded", async () => {
    const dev = (id: string, at: number, connected: boolean, via?: string) => ({ deviceId: id, publicKey: "k", displayName: "Phone", clientId: "ios", platform: "ios", roles: ["node"], approvedAtMs: at, createdAtMs: at, connected, ...(via ? { approvedVia: via } : {}) });
    const paired = [dev("new", Date.now() - 3_600_000, true, "silent"), dev("old", Date.now() - 9_000_000, false, "silent"), dev("owner", Date.now() - 9_500_000, false, "owner")];
    const { engine, request } = engineWith({ ...CONFIG, "device.pair.list": { pending: [], paired }, "device.pair.remove": { ok: true } });
    await show(engine, "advanced");
    await click(buttons("Clean up 1 old")[0]);
    await click(buttons("Remove them")[0]);
    const removed = request.mock.calls.filter(([m]) => m === "device.pair.remove").map(([, p]) => p);
    expect(removed).toEqual([{ deviceId: "old" }]);
  });
  it("Waiting for your yes lists the engine's pending requests and answers them with *.pair.approve / *.pair.reject", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { engine, request } = engineWith({ ...CONFIG,
        "device.pair.list": { pending: [{ requestId: "d-req", deviceId: "dev-9", publicKey: "k", displayName: "Studio laptop", platform: "win32", scopes: ["operator.read"], ts: Date.now() }], paired: [] },
        "node.pair.list": { pending: [{ requestId: "n-req", nodeId: "node-7", displayName: "Garage box", platform: "linux", commands: ["system.run"], coreVersion: "0.19.4", ts: Date.now() - 1000 }], paired: [] },
        "device.pair.approve": { ok: true }, "node.pair.reject": { ok: true } });
      await show(engine, "technical");
      const waiting = sec("Waiting for your yes");
      expect(waiting?.textContent).toContain("Studio laptop wants to connect");
      expect(waiting?.textContent).toContain("Garage box wants to connect");
      expect(waiting?.textContent).toContain("Run commands");
      expect(waiting?.textContent).not.toContain("0.19.4");
      const allow = row("Studio laptop")!.querySelector("button.pri, button:last-of-type") as HTMLButtonElement;
      expect(allow.disabled).toBe(true);
      await act(async () => { vi.advanceTimersByTime(1600); });
      expect(allow.disabled).toBe(false);
      await click(allow);
      expect(request).toHaveBeenCalledWith("device.pair.approve", { requestId: "d-req" });
      await click([...row("Garage box")!.querySelectorAll("button")].find((b) => b.textContent === "Don’t allow")!);
      await click(buttons("Turn it down")[0]);
      expect(request).toHaveBeenCalledWith("node.pair.reject", { requestId: "n-req" });
    } finally { vi.useRealTimers(); }
  });

  it("hides Waiting for your yes when nothing is pending", async () => {
    const { engine } = engineWith({ ...CONFIG, "device.pair.list": { pending: [], paired: [] }, "node.pair.list": { pending: [], paired: [] } });
    await show(engine, "regular");
    expect(sec("Waiting for your yes")).toBeNull();
  });

  it("Which Trunk uses which shows every Trunk, the main one last, and pins one to a computer", async () => {
    window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    const agents = { defaultId: "main", agents: [{ id: "main", identity: { name: "Sapling" } }, { id: "scout", identity: { name: "Scout" } }] };
    const { engine: bare } = engineWith({ ...CONFIG, "agents.list": agents });
    await show(bare, "regular");
    const which = sec("Which Trunk uses which");
    expect(which?.querySelector(".hint")?.textContent).toBe("A Trunk can use several computers side by side.");
    expect([...which!.querySelectorAll(".prow b")].map((b) => b.textContent)).toEqual(["Scout", "Sapling"]);
    const { engine, request } = engineWith({ ...CONFIG, "agents.list": agents, "config.get": { hash: "h", valid: true, config: { agents: { entries: { scout: {} } } } }, "node.list": { nodes: [{ nodeId: "n1", displayName: "Desk", connected: true }] } });
    await show(engine, "regular");
    const chip = [...sec("Which Trunk uses which")!.querySelectorAll<HTMLButtonElement>("[aria-label='Computers Scout uses'] button")].find((b) => b.textContent === "Desk")!;
    await click(chip);
    expect(patches(request)).toContainEqual({ agents: { entries: { scout: { tools: { exec: { node: "n1" } } } } } });
  });

  it("saves Most spares at once with Save and adds an extra folder from its dialog", async () => {
    const { engine, request } = engineWith(CONFIG);
    await show(engine, "advanced");
    const input = row("Most spares at once")!.querySelector("input") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "2"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click([...row("Most spares at once")!.querySelectorAll("button")].find((b) => b.textContent === "Save")!);
    expect(patches(request)).toContainEqual({ cloudWorkers: { preparedPool: { maxTotal: 2 } } });
    expect(row("Extra folders")?.textContent).toContain("No extra folders.");
    await click(buttons("Add a folder")[0]);
    const field = document.querySelector("[role=dialog] input, .dlg input") as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, "C:\data:/data:ro"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(buttons("Add").at(-1)!);
    expect(patches(request)).toContainEqual({ agents: { defaults: { sandbox: { docker: { binds: ["C:\data:/data:ro"] } } } } });
  });
});
