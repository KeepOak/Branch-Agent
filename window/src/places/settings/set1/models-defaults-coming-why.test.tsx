// @vitest-environment jsdom
// Private #1093 / Ease #5: remaining Models Defaults off={NONE} rows (dev notes stripped by
// shownWhy). Coming copy + Technical-only via Ctl isComingWhy. Planning is covered by #2037.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { ModelsPage } from "./models";
import {
  ADD_PICTURES_WHY,
  HOW_TRUNKS_WHY,
  START_LEFT_OFF_WHY,
  SUGGEST_PATTERN_WHY,
} from "./models-defaults";
import { MODELS_ROWS } from "./models-rows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };

async function render(level: 0 | 1 | 2) {
  const config = { agents: { defaults: { model: { primary: "local/main", fallbacks: ["local/spare"] } }, entries: {} } };
  const request = vi.fn(async (method: string) => {
    if (method === "models.list") {
      return {
        models: [
          { id: "main", provider: "local", name: "Main model", local: true },
          { id: "spare", provider: "local", name: "Spare model", local: true },
        ],
      };
    }
    if (method === "models.authStatus") return { providers: [] };
    if (method === "config.get") return { hash: "h1", valid: true, config };
    if (method === "users.prefs.get") return { entries: {} };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
  await act(async () =>
    root.render(
      <KitProvider level={level} report={report} scope={null}>
        <ModelsPage page="models" title="Models" level="regular" engine={engine} />
      </KitProvider>,
    ),
  );
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const row = (title: string) => host.querySelector<HTMLElement>(`[data-row="${title}"]`);

describe("Settings › Models Defaults Coming siblings (#1093)", () => {
  it("hides Add pictures / Start where you left off below Technical", async () => {
    await render(0);
    expect(row("Everyday answers")).not.toBeNull();
    expect(row("Add pictures and tools to any model")).toBeNull();
    expect(row("Start where you left off")).toBeNull();
    expect(host.textContent).not.toContain(ADD_PICTURES_WHY);
    expect(host.textContent).not.toContain(START_LEFT_OFF_WHY);

    await render(1);
    // New conversations mounts at Advanced; Fast replies stays, Start where is Coming.
    expect(row("Fast replies")).not.toBeNull();
    expect(row("Start where you left off")).toBeNull();
    expect(row("Add pictures and tools to any model")).toBeNull();
    // How Trunks is Technical-only in models-more.
    expect(host.querySelector('[aria-label="How Trunks work together"]')).toBeNull();
  });

  it("at Technical names Coming why for Add pictures, Start where, How Trunks, and Suggest", async () => {
    await render(2);
    const add = row("Add pictures and tools to any model");
    expect(add).not.toBeNull();
    expect(add!.className).toContain("off-k");
    expect(add!.textContent).toContain(ADD_PICTURES_WHY);
    const addWhy = add!.querySelector("small.why-k") ?? [...add!.querySelectorAll("small")].find((s) => s.textContent?.includes("later update"));
    expect(addWhy).toBeTruthy();
    for (const el of add!.querySelectorAll<HTMLElement>("button, [role=switch]")) {
      expect(el.getAttribute("aria-describedby")).toBe(addWhy!.id);
    }

    const start = row("Start where you left off");
    expect(start).not.toBeNull();
    expect(start!.textContent).toContain(START_LEFT_OFF_WHY);

    const suggest = row("A Trunk may suggest a different pattern");
    expect(suggest).not.toBeNull();
    expect(suggest!.textContent).toContain(SUGGEST_PATTERN_WHY);

    const patterns = host.querySelector('[aria-label="How Trunks work together"]');
    expect(patterns).not.toBeNull();
    expect(host.textContent).toContain(HOW_TRUNKS_WHY);
    const whyId = patterns!.getAttribute("aria-describedby");
    expect(whyId).toBeTruthy();
    expect(document.getElementById(whyId!)?.textContent).toBe(HOW_TRUNKS_WHY);

    // Working neighbour still draws.
    expect(row("Fast replies")).not.toBeNull();
    expect(row("Fast replies")!.className).not.toContain("off-k");
  });

  it("lists Coming siblings at Technical in the search index", () => {
    const lv = (title: string) => MODELS_ROWS.filter((r) => r.title === title).map((r) => r.lv);
    expect(lv("Add pictures and tools to any model")).toEqual([2]);
    expect(lv("A Trunk may suggest a different pattern")).toEqual([2]);
    expect(lv("Start where you left off")).toEqual([2]);
    expect(lv("Fast replies")).toEqual([1]);
  });
});
