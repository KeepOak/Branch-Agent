// @vitest-environment jsdom
// #1769 point 3 (related #553): with no model set up, Models › Default names both routes, add an account or use a
// model on this computer, and each one has a button that opens it.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { ModelsPage } from "./models";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  sessionStorage.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  sessionStorage.clear();
});

const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };

async function render(openSettings?: (page: string) => void) {
  const config = { agents: { defaults: {}, entries: {} } };
  const request = vi.fn(async (method: string) => {
    if (method === "models.list") return { models: [] };
    if (method === "models.authStatus") return { providers: [] };
    if (method === "config.get") return { hash: "h1", valid: true, config };
    if (method === "users.prefs.get") return { entries: {} };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
  await act(async () =>
    root.render(
      <KitProvider level={0} report={report} scope={null}>
        <ModelsPage page="models" title="Models" level="regular" engine={engine} openSettings={openSettings} />
      </KitProvider>,
    ),
  );
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === name);

describe("Settings › Models › Default with no model (#1769)", () => {
  it("explains both routes: add an account, or use a model on this computer", async () => {
    await render(() => undefined);
    const text = host.textContent ?? "";
    expect(text).toContain("Add an account");
    expect(text).toMatch(/model on this computer/i);
    expect(text).toMatch(/no account/i);
  });

  it("Add an account opens the add-account picker in Accounts", async () => {
    const openSettings = vi.fn();
    await render(openSettings);
    const add = button("Add an account");
    expect(add).toBeTruthy();
    expect(add!.disabled).toBe(false);
    await act(async () => add!.click());
    expect(sessionStorage.getItem("branch.openAddAccount")).toBe("1");
    expect(openSettings).toHaveBeenCalledWith("accounts");
  });

  it("Use a model on this computer opens Local", async () => {
    const openSettings = vi.fn();
    await render(openSettings);
    const local = button("Use a model on this computer");
    expect(local).toBeTruthy();
    expect(local!.disabled).toBe(false);
    await act(async () => local!.click());
    expect(openSettings).toHaveBeenCalledWith("local");
    expect(sessionStorage.getItem("branch.openAddAccount")).toBeNull();
  });
});
