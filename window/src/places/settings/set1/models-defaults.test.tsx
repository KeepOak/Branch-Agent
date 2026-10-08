// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { ModelsPage } from "./models";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
const ownModels = {
  scout: { identity: { name: "Scout" }, model: "local/main" },
  writer: { name: "Writer", model: { primary: "local/main" } },
  helper: { model: { primary: "local/main", fallbacks: ["local/spare"] } },
  inherited: {},
  empty: { model: "  " },
  emptyObject: { model: {} },
};
async function render(entries: Record<string, unknown> = {}, scope: string | null = null, level: 0 | 1 = 0) {
  const config = { agents: { defaults: { model: { primary: "local/main", fallbacks: ["local/spare"] } }, entries } };
  const request = vi.fn(async (method: string) => {
    if (method === "models.list") return { models: [
      { id: "main", provider: "local", name: "Main model", local: true },
      { id: "spare", provider: "local", name: "Spare model", local: true },
    ] };
    if (method === "models.authStatus") return { providers: [] };
    if (method === "config.get") return { hash: "h1", valid: true, config };
    if (method === "users.prefs.get") return { entries: {} };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
  await act(async () => root.render(<KitProvider level={level} report={report} scope={scope}><ModelsPage page="models" title="Models" level="regular" engine={engine} /></KitProvider>));
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Defaults")!.click());
  return request;
}
const notes = () => [...host.querySelectorAll<HTMLUListElement>('ul[aria-label="Trunks with their own model"]')];

describe("global model fallback note", () => {
  it("names only Trunks with a string or object primary, even when it matches the default", async () => {
    await render(ownModels);
    expect(notes()).toHaveLength(1);
    expect([...notes()[0].querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Scout", "Writer", "helper"]);
    const row = host.querySelector('[data-row="If the model fails"]')!;
    expect(notes()[0].closest("[data-row]")).toBe(row);
    const section = row.closest(".sec")!;
    expect(section).not.toBeNull();
    expect([...section.children].filter((child) => !child.matches("h2, p, .ctl"))).toHaveLength(0);
    expect(row.textContent).toContain("do not use this setting for answers");
    expect(row.textContent).toContain("Advanced detail");
    expect(row.textContent).toContain("What it may do › Add a stand-in…");
  });

  it("also explains the Advanced fallback list", async () => {
    await render(ownModels, null, 1);
    expect(notes()).toHaveLength(2);
    const section = [...host.querySelectorAll(".sec")].find((s) => s.querySelector("h2")?.textContent === "If the model fails");
    expect(section).toBeDefined();
    expect(section?.querySelector('ul[aria-label="Trunks with their own model"]')).not.toBeNull();
  });

  it("opens the selected Trunk editor through existing navigation without saving config", async () => {
    const request = await render(ownModels);
    const events: unknown[] = [];
    const capture = (event: Event) => events.push([event.type, (event as CustomEvent).detail]);
    window.addEventListener("branch:navigate-place", capture);
    window.addEventListener("branch:open-trunk", capture);
    try {
      await act(async () => notes()[0].querySelectorAll<HTMLButtonElement>("button")[1].click());
      expect(events).toEqual([
        ["branch:navigate-place", { place: "people" }],
        ["branch:open-trunk", { agentId: "writer", view: "edit" }],
      ]);
      expect(request.mock.calls.some(([method]) => method === "config.patch")).toBe(false);
    } finally {
      window.removeEventListener("branch:navigate-place", capture);
      window.removeEventListener("branch:open-trunk", capture);
    }
  });

  it("does not warn in an individual Trunk's settings", async () => {
    await render(ownModels, "scout", 1);
    expect(notes()).toHaveLength(0);
    expect(host.textContent).not.toContain("do not use this setting");
  });

  it("does not warn when no Trunk has its own model", async () => {
    await render({ inherited: {}, empty: { model: "" }, emptyPrimary: { model: { primary: " " } } }, null, 1);
    expect(notes()).toHaveLength(0);
    expect(host.textContent).not.toContain("do not use this setting");
  });
});
