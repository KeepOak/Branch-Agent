// @vitest-environment jsdom
// Private #1093 item 3: Permissions says one thing about commands. Access and "Commands may run" both apply and the
// stricter one wins (engine exec-approvals-effective), so Access on Ask first never sits beside an unexplained "Any".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { PermissionsPage } from "./permissions";
import { commandsNow } from "./permissions-commands";

vi.mock("../../../shell/notify", () => ({ notify: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

const snap = (security: string, ask = "off") => ({ path: "/x/exec-approvals.json", exists: true, hash: "e1", file: { version: 1 }, resolvedDefaults: { security, ask, askFallback: "deny", autoAllowSkills: false } });
const AGENTS = { defaultId: "main", agents: [{ id: "main", identity: { name: "Sapling" } }] };
function engineOf(mode: string, security: string, ask = "off") {
  const request = vi.fn(async (method: string, params?: unknown) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: { tools: { exec: { mode } } } };
    if (method === "config.patch") return { ok: true, hash: "h2", config: {} };
    if (method === "agents.list") return AGENTS;
    if (method === "exec.approvals.get") return snap(security, ask);
    if (method === "exec.approvals.set") return { ...snap(security, ask), hash: "e2", file: (params as { file: unknown }).file };
    if (method === "node.list") return { nodes: [] };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine) {
  await act(async () => root.render(<KitProvider level={1} report={report} scope={null}><PermissionsPage page="permissions" title="Permissions" level="advanced" engine={engine} /></KitProvider>));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const checked = () => host.querySelector('[data-row="Access"] [role="radio"][aria-checked="true"]')?.textContent ?? "";
const now = () => host.querySelector(".pm-now")?.textContent ?? "";
const runRow = () => host.querySelector('[data-row="Commands may run"]');

describe("Permissions: Access and Commands may run say one thing", () => {
  it("Ask first beside Any: the page says Access decides and what that means now", async () => {
    await render(engineOf("ask", "full"));
    expect(checked()).toContain("Ask first");
    expect(runRow()?.querySelector('[aria-pressed="true"], [aria-checked="true"]')?.textContent).toContain("Any");
    expect(now()).toBe("Right now, with Access on Ask first: Commands on the allowed list run. Any other waits for your yes.");
    expect(runRow()?.textContent).toContain("Access is on Ask first, which is stricter, so Access decides.");
    expect(host.textContent).not.toContain("Follows Access unless you set it here.");
  });

  it("Full access with only listed ones: the stricter default wins and no Access note shows", async () => {
    await render(engineOf("full", "allowlist"));
    expect(checked()).toContain("Full access");
    expect(now()).toBe("Right now, with Access on Full access: Only commands on the allowed list run. Any other is refused.");
    expect(runRow()?.textContent).not.toContain("so Access decides");
  });

  it("Read only means no command, whatever the default says", async () => {
    await render(engineOf("deny", "full"));
    expect(now()).toBe("Right now, with Access on Read only: No command runs.");
  });
});

describe("commandsNow: the stricter of Access and the defaults, as the engine combines them", () => {
  it.each([
    ["ask", "full", "off", "Commands on the allowed list run. Any other waits for your yes."],
    ["ask", "deny", "off", "No command runs."],
    ["ask", "allowlist", "always", "Branch asks you before every command."],
    ["auto", "full", "off", "Commands on the allowed list run. A reviewer checks any other and asks you when it isn’t sure."],
    ["full", "full", "off", "Any command runs without asking."],
    ["full", "allowlist", "on-miss", "Commands on the allowed list run. Any other waits for your yes."],
    ["deny", "full", "off", "No command runs."],
    ["", "full", "off", "Any command runs without asking."],
  ])("Access %s, default %s / ask %s", (mode, security, ask, line) => {
    expect(commandsNow(mode, { security, ask })).toBe(line);
  });
});
