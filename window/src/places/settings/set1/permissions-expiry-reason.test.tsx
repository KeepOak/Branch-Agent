// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, NOSETUP, SetupLock, type SaveReport } from "../kit";
import { PermissionsPage } from "./permissions";

vi.mock("../../../shell/notify", () => ({ notify: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

const CONFIG = { hash: "h1", valid: true, config: { tools: { exec: { grantExpiryDays: 30 } } } };
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };

function engineOf(config: Promise<typeof CONFIG>) {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return config;
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", defaultPermissionMode: "full" }] };
    if (method === "exec.approvals.get") return { exists: true, hash: "e1", file: { version: 1, agents: {} } };
    if (method === "node.list") return { nodes: [] };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
}

async function render(engine: WindowEngine, locked = false) {
  await act(async () => root.render(
    <KitProvider level={1} report={report} scope={null}>
      <SetupLock locked={locked}><PermissionsPage page="permissions" title="Permissions" level="regular" engine={engine} /></SetupLock>
    </KitProvider>,
  ));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

const row = () => host.querySelector<HTMLElement>('[data-row="Standing permissions end after"]')!;
const field = () => row().querySelector<HTMLInputElement>('input[type="number"]')!;

describe("standing-permission expiry reason", () => {
  it("shows one visible loading reason, then enables the expiry field when settings arrive", async () => {
    let finish!: (value: typeof CONFIG) => void;
    const config = new Promise<typeof CONFIG>((resolve) => { finish = resolve; });
    await render(engineOf(config));
    try {
      expect(field().disabled).toBe(true);
      const reasons = row().querySelectorAll<HTMLElement>(".why-k");
      expect(reasons).toHaveLength(1);
      expect(reasons[0].textContent).toBe("Loading your settings…");
      expect(reasons[0].closest('[hidden], [inert], [aria-hidden="true"]')).toBeNull();
      expect(field().getAttribute("aria-describedby")).toBe(reasons[0].id);
    } finally {
      await act(async () => { finish(CONFIG); await config; });
    }
    expect(field().disabled).toBe(false);
    expect(field().value).toBe("30");
    expect(row().hasAttribute("aria-disabled")).toBe(false);
    expect(field().closest("[inert]")).toBeNull();
    expect(row().querySelector(".why-k")).toBeNull();
  });

  it("keeps the visible setup-permission reason when the loaded field is locked", async () => {
    await render(engineOf(Promise.resolve(CONFIG)), true);
    expect(row().getAttribute("aria-disabled")).toBe("true");
    const reason = row().querySelector<HTMLElement>(".why-k")!;
    expect(reason.textContent).toBe(NOSETUP);
    expect(reason.closest('[hidden], [inert], [aria-hidden="true"]')).toBeNull();
    expect(field().getAttribute("aria-describedby")).toBe(reason.id);
  });
});
