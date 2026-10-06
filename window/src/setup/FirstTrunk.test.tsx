// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { readTrunks } from "../shell/engine-data";
import { SetupFlow } from "./SetupFlow";
import { needsFirstContact } from "./setup-model";
import { FirstTrunk } from "./FirstTrunk";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

it("requires first-contact creation before setup/chat and retries failed default selection without creating twice", async () => {
  let createFailed = true, defaultFailed = true;
  const request = vi.fn(async (method: string) => {
    if (method === "agents.create") {
      if (createFailed) throw new Error("Workspace creation failed");
      return { ok: true, agentId: "fern" };
    }
    if (method === "agents.list") return { defaultId: "bootstrap", agents: [{ id: "bootstrap", kind: "system" }, { id: "fern", identity: { name: "Fern" } }] };
    if (method === "config.get") return { hash: "h1", config: { agents: { entries: { bootstrap: {}, fern: {} } } } };
    if (method === "config.patch" && defaultFailed) throw new Error("Configuration changed; try again");
    return { ok: true };
  });
  const engine = { request, onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as unknown as WindowEngine;
  const onClose = vi.fn();
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root!.render(<SetupFlow engine={engine} version="1" trunkNames={[]} requireContact defaultAgentId="bootstrap" defaultName="Branch" startAt={4} onClose={onClose} onLocalModel={() => {}} />));
  expect(host.textContent).toContain("Create your first Trunk");
  expect(host.querySelector('[data-testid="setup-finish"]')).toBeNull();
  expect(host.querySelector('[data-testid="setup-skip"]')).toBeNull();
  const input = host.querySelector("input")!;
  expect(input.labels?.[0]?.textContent).toContain("Name your Trunk");
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Fern"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  const click = async () => { await act(async () => (host.querySelector('[data-testid="first-trunk-create"]') as HTMLButtonElement).click()); };
  await click();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Workspace creation failed");
  expect(onClose).not.toHaveBeenCalled();
  createFailed = false;
  await click();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Configuration changed");
  expect(onClose).not.toHaveBeenCalled();
  // agents.changed may update the shell before config.patch succeeds; the gate must stay pinned.
  await act(async () => root!.render(<SetupFlow engine={engine} version="1" trunkNames={[]} defaultAgentId="bootstrap" defaultName="Branch" startAt={4} onClose={onClose} onLocalModel={() => {}} />));
  expect(host.textContent).toContain("Create your first Trunk");
  defaultFailed = false;
  await click();
  expect(request.mock.calls.filter(([method]) => method === "agents.create")).toHaveLength(2);
  expect(request).toHaveBeenCalledWith("agents.create", { name: "Fern" });
  expect(request).toHaveBeenCalledWith("config.patch", { baseHash: "h1", raw: JSON.stringify({ agents: { defaultId: "fern" } }) });
  expect(host.textContent).not.toContain("Create your first Trunk");
  expect(host.querySelector("h2")?.textContent).toBe("Your first Trunks");
});

it("does not mistake system workers for user contact Trunks", () => {
  expect(readTrunks({ defaultId: "bootstrap", agents: [{ id: "bootstrap", kind: "system" }, { id: "helper", kind: "system" }] }).list).toEqual([]);
  expect(readTrunks({ defaultId: "branch", agents: [{ id: "branch", kind: "agent" }, { id: "helper", kind: "system" }, { id: "legacy" }, {}] }).list.map(a => a.id)).toEqual(["branch", "legacy"]);
});

it("supports form submission and ignores repeated submissions while creation is pending", async () => {
  let release!: (value: unknown) => void;
  const request = vi.fn(async (method: string) => {
    if (method === "agents.create") return new Promise(resolve => { release = resolve; });
    if (method === "agents.list") return { agents: [{ id: "fern" }] };
    if (method === "config.get") return { hash: "h1", config: { agents: { entries: { fern: {} } } } };
    return { ok: true };
  });
  const onCreated = vi.fn();
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root!.render(<FirstTrunk engine={{ request } as unknown as WindowEngine} onCreated={onCreated} />));
  const input = host.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Fern");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const form = host.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(request.mock.calls.filter(([method]) => method === "agents.create")).toHaveLength(1);
  expect(form.getAttribute("aria-busy")).toBe("true");
  expect(onCreated).not.toHaveBeenCalled();
  await act(async () => release({ ok: true, agentId: "fern" }));
  expect(onCreated).toHaveBeenCalledExactlyOnceWith("fern", "Fern");
});

it("requires contact creation for fresh bootstrap state but preserves existing users and confirmed contacts", () => {
  expect(needsFirstContact({ config: { agents: { entries: { bootstrap: {} } } } })).toBe(true);
  expect(needsFirstContact({ config: { wizard: { lastRunAt: "2026-10-03" }, agents: { entries: { dev: {} } } } })).toBe(false);
  expect(needsFirstContact({ config: { agents: { defaultId: "fern", entries: { fern: {} } } } })).toBe(false);
});

it.each(["agents.create", "agents.list", "config.get", "config.patch"])("blocks completion when %s refuses and only advances after default persistence", async (failure) => {
  let failed = true;
  let persistedDefault = "bootstrap";
  const request = vi.fn(async (method: string, params: unknown) => {
    if (method === failure && failed) {
      if (method === "agents.create" || method === "config.patch") return { ok: false, error: { message: "Refused" } };
      throw new Error("Refused");
    }
    if (method === "agents.create") return { ok: true, agentId: "fern" };
    if (method === "agents.list") return { defaultId: persistedDefault, agents: [{ id: "bootstrap", kind: "system" }, { id: "fern", kind: "agent" }] };
    if (method === "config.get") return { hash: "revision", config: { agents: { entries: { bootstrap: {}, fern: {} } } } };
    if (method === "config.patch") persistedDefault = JSON.parse((params as { raw: string }).raw).agents.defaultId;
    return { ok: true };
  });
  const engine = { request } as unknown as WindowEngine;
  const onCreated = vi.fn(() => expect(persistedDefault).toBe("fern"));
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root!.render(<FirstTrunk engine={engine} onCreated={onCreated} />));
  const input = host.querySelector("input")!;
  expect((host.querySelector("button[data-testid=first-trunk-create]") as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, " Fern "); input.dispatchEvent(new Event("input", { bubbles: true })); });
  const click = async () => { await act(async () => (host.querySelector('[data-testid="first-trunk-create"]') as HTMLButtonElement).click()); };
  await click();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Refused");
  expect(onCreated).not.toHaveBeenCalled();
  expect(persistedDefault).toBe("bootstrap");
  failed = false;
  await click();
  expect(onCreated).toHaveBeenCalledExactlyOnceWith("fern", "Fern");
  expect(request.mock.calls.filter(([method]) => method === "agents.create")).toHaveLength(failure === "agents.create" ? 2 : 1);
});
