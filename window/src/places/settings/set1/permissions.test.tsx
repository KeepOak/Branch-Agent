// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { PermissionsPage, PERMISSIONS_ROWS } from "./permissions";
import { notify } from "../../../shell/notify";

vi.mock("../../../shell/notify", () => ({ notify: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

const SNAP = { path: "/x/exec-approvals.json", exists: true, hash: "e1", file: { version: 1, agents: { "*": { allowlist: [{ pattern: "git status" }, { pattern: "git log" }] } } }, resolvedDefaults: { security: "full", ask: "off", askFallback: "deny", autoAllowSkills: false } };
const AGENTS = { defaultId: "main", agents: [{ id: "main", identity: { name: "Sapling" }, defaultPermissionMode: "full" }, { id: "t2", name: "Helper" }] };

function engineOf(over: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method in over) { const v = over[method]; return typeof v === "function" ? (v as (p: unknown) => unknown)(params) : v; }
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.patch") return { ok: true, hash: "h2", config: {} };
    if (method === "agents.list") return AGENTS;
    if (method === "exec.approvals.get") return SNAP;
    if (method === "exec.approvals.set") return { ...SNAP, hash: "e2", file: (params as { file: unknown }).file };
    if (method === "node.list") return { nodes: [] };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine, request };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine, level: 0 | 1 | 2 = 0) {
  await act(async () => root.render(<KitProvider level={level} report={report} scope={null}><PermissionsPage page="permissions" title="Permissions" level="regular" engine={engine} /></KitProvider>));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const heads = () => [...host.querySelectorAll(".sec > h2:not([hidden])")].map((h) => h.textContent);
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label || b.textContent?.trim().startsWith(label))!;
const patchOf = (request: ReturnType<typeof vi.fn>) => JSON.parse((request.mock.calls.find(([m]) => m === "config.patch") as [string, { raw: string }])[1].raw);

describe("Settings › Permissions", () => {
  it("shows the engine's mode and the Regular sections in the preview's order", async () => {
    const { engine } = engineOf();
    await render(engine);
    expect(heads()).toEqual(["This computer", "Access"]);
    expect(host.querySelector('[role="radio"][aria-checked="true"]')?.textContent).toContain("Full access");
    expect(host.textContent).not.toContain("Work style");
    expect(button("Plan first")).toBeUndefined();
  });

  it("adds the Advanced and Technical sections in place", async () => {
    const { engine } = engineOf();
    await render(engine, 1);
    expect(heads()).toEqual(["This computer", "Access", "Locks and records", "Rules and checks", "Sandbox", "Privacy", "Your terminal", "Approvals", "Guards"]);
    await render(engine, 2);
    expect(heads()).toContain("Rules and checks");
    expect(heads()).toContain("Sandbox");
    expect(heads()).not.toContain("Tools, technical");
  });

  it("says Full access does not include the screen switch and can open it", async () => {
    const openSettings = vi.fn();
    const { engine } = engineOf();
    await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><PermissionsPage page="permissions" title="Permissions" level="regular" engine={engine} openSettings={openSettings} /></KitProvider>));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(host.textContent).toContain("Full access does not turn on seeing the screen or using the mouse");
    expect(host.textContent).toContain("Settings › Computer & browser › See the screen and use the mouse");
    await act(async () => button("Open that switch").click());
    expect(openSettings).toHaveBeenCalledWith("computer");
  });

  it("Access saves tools.exec.mode without the older security/ask keys", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    await act(async () => button("Ask first").click());
    expect(patchOf(request)).toEqual({ tools: { exec: { mode: "ask", security: null, ask: null } } });
  });

  it("turns on Lockdown globally and disables Access mode changes", async () => {
    vi.mocked(notify).mockClear();
    const { engine, request } = engineOf({
      "config.patch": (params: unknown) => {
        // Verify config.patch is called with exactly {raw, baseHash} params (Preview spec-v23 index.html:8378)
        const p = params as Record<string, unknown>;
        expect(Object.keys(p).sort()).toEqual(["baseHash", "raw"]);
        return { ok: true, hash: "h2", config: JSON.parse((params as { raw: string }).raw) };
      },
    });
    await render(engine);
    const turnOnBtn = button("Turn Lockdown on");
    expect(turnOnBtn?.className).toContain("bad"); // Preview spec-v23 index.html:8553 button class when off
    await act(async () => turnOnBtn?.click());
    expect(request.mock.calls.some(([m]) => m === "config.patch")).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="confirm-lockdown"] .dlg-f button:last-child')!.click());
    expect(patchOf(request)).toEqual({ security: { lockdown: true } });
    // Verify toast shown on success (Preview spec-v23 index.html:8910)
    expect(vi.mocked(notify)).toHaveBeenCalledWith("Lockdown is on.");
    const turnOffBtn = button("Turn Lockdown off");
    expect(turnOffBtn).toBeTruthy();
    expect(turnOffBtn?.className).not.toContain("bad"); // Preview spec-v23 index.html:8553 button class when on
    // Verify status box appears when locked (Preview spec-v23 index.html:8540)
    expect(host.textContent).toContain("Lockdown is on");
    expect(host.textContent).toContain("Nothing leaves this computer and nothing is changed until you turn it off.");
    // The status box opens the page, before every section (preview index.html:8540).
    const status = host.querySelector('[data-row="Lockdown status"]')!;
    expect(status.compareDocumentPosition(host.querySelector(".sec")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button("Ask first").disabled).toBe(true);
  });

  it("toasts \"Lockdown is off.\" when switched off (preview index.html:8910)", async () => {
    vi.mocked(notify).mockClear();
    const { engine } = engineOf({
      "config.get": { hash: "h1", valid: true, config: { security: { lockdown: true } } },
      "config.patch": (params: unknown) => ({ ok: true, hash: "h2", config: JSON.parse((params as { raw: string }).raw) }),
    });
    await render(engine);
    await act(async () => button("Turn Lockdown off").click());
    expect(vi.mocked(notify)).toHaveBeenCalledWith("Lockdown is off.");
    expect(button("Turn Lockdown on")).toBeTruthy();
  });

  it("shows the engine's refusal and no success toast when the switch fails", async () => {
    vi.mocked(notify).mockClear();
    const { engine } = engineOf({
      "config.get": { hash: "h1", valid: true, config: { security: { lockdown: true } } },
      "config.patch": () => { throw new Error("Only the owner can switch Lockdown off."); },
    });
    await render(engine);
    await act(async () => button("Turn Lockdown off").click());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(vi.mocked(notify)).not.toHaveBeenCalledWith("Lockdown is off.");
    expect(vi.mocked(notify)).toHaveBeenCalledWith(expect.stringContaining("Only the owner can switch Lockdown off."), { tone: "bad" });
  });

  it("Access arrows select a mode; a mode this version lacks is not offered", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    const group = host.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Access"]')!;
    const selected = group.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')!;
    expect(selected.textContent).toContain("Full access");
    expect(button("Plan first")).toBeUndefined();
    await act(async () => selected.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(document.activeElement?.textContent).toContain("Auto");
    expect(patchOf(request)).toEqual({ tools: { exec: { mode: "auto", security: null, ask: null } } });
  });

  it("lists the rules from the approvals file and saves with its base hash", async () => {
    const { engine, request } = engineOf();
    await render(engine, 1);
    expect([...host.querySelectorAll(".prow b")].map((b) => b.textContent)).toEqual(expect.arrayContaining(["git status", "git log"]));
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button[aria-label="Move up"]')][1].click());
    const set = request.mock.calls.find(([m]) => m === "exec.approvals.set") as [string, { file: typeof SNAP.file; baseHash: string }];
    expect(set[1].baseHash).toBe("e1");
    expect(set[1].file.agents["*"].allowlist.map((r) => r.pattern)).toEqual(["git log", "git status"]);
  });

  it("Commands may run writes the file's default security; each Trunk gets its own row", async () => {
    const { engine, request } = engineOf();
    await render(engine, 1);
    expect(host.querySelector('[data-row="Helper"]')).not.toBeNull();
    await act(async () => button("Only listed ones").click());
    const set = request.mock.calls.find(([m]) => m === "exec.approvals.set") as [string, { file: { defaults: unknown } }];
    expect(set[1].file.defaults).toEqual({ security: "allowlist" });
  });

  it("the empty rules list uses the empty line, and greyed rows are not drawn", async () => {
    const { engine } = engineOf({ "exec.approvals.get": { ...SNAP, file: { version: 1 } } });
    await render(engine, 1);
    expect(host.textContent).toContain("No rules yet. Everything follows the mode.");
    expect(host.querySelector('[data-row="App lock"]')).toBeNull();
    expect(host.textContent).not.toContain("The engine has no app lock or PIN yet.");
  });

  it("Stop a Trunk that repeats itself turns off by removing the key, keeping the engine's own guard", async () => {
    const { engine, request } = engineOf({ "config.get": { hash: "h1", valid: true, config: { tools: { loopDetection: { enabled: true } } } } });
    await render(engine, 1);
    await act(async () => host.querySelector<HTMLInputElement>('input[aria-label="Stop a Trunk that repeats itself"]')!.click());
    expect(patchOf(request)).toEqual({ tools: { loopDetection: { enabled: null } } });
  });

  it("the Approvals dialog lists standing permissions and revokes one", async () => {
    const grant = { grantId: "g1", cronJobId: "c1", cronJobName: "Morning brief", command: "curl x", useCount: 2, revokedAtMs: null, expiresAtMs: null };
    const { engine, request } = engineOf({ "exec.approval.grants.list": { grants: [grant] }, "exec.approval.grants.revoke": { outcome: "revoked" }, "exec.approval.list": [], "approval.history": { items: [] } });
    await render(engine, 1);
    const open = host.querySelector<HTMLButtonElement>('[data-row="Approvals"] button:not(.pin-k)');
    expect(open).not.toBeNull();
    await act(async () => open!.click());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(document.querySelector('[data-testid="approvals"]')!.textContent).toContain("Morning brief");
    await act(async () => button("Revoke").click());
    expect(request).toHaveBeenCalledWith("exec.approval.grants.revoke", { grantId: "g1" });
  });

  it("every search entry has a row on the page to jump to", async () => {
    const { engine } = engineOf();
    await render(engine, 2);
    const rows = new Set([...host.querySelectorAll<HTMLElement>("[data-row]")].map((r) => r.dataset.row));
    expect(PERMISSIONS_ROWS.map((r) => r.title).filter((t) => !rows.has(t))).toEqual([]);
  });

  it("lists every row for search, at its level", () => {
    const find = (t: string) => PERMISSIONS_ROWS.find((r) => r.title === t);
    expect(find("Access")?.lv).toBe(0);
    expect(find("Commands may run")?.lv).toBe(1);
    expect(find("Code mode")?.lv).toBe(2);
    expect(find("Sandbox")?.sec).toBe("Isolation");
  });
});

describe("Settings › Permissions on a partial engine reply", () => {
  it("renders every level, without crashing, when the approvals file and other replies are empty", async () => {
    const { engine } = engineOf({ "exec.approvals.get": {}, "agents.list": {} });
    for (const level of [0, 1, 2] as const) {
      await render(engine, level);
      expect(host.querySelector("h1")?.textContent).toBe("Permissions");
    }
  });
});
