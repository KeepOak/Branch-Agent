// @vitest-environment jsdom
// Private #1093 / Ease #5 slice: Models › Planning and hard problems was greyed with off={NONE},
// a dev note that shownWhy strips, so the Seg had no visible why. Coming copy survives shownWhy
// and Ctl hides the row below Technical.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { ModelsPage } from "./models";
import { PLANNING_WHY } from "./models-defaults";
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
  // Let models.list / config.get settle.
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
  return request;
}

const planning = () => host.querySelector<HTMLElement>('[data-row="Planning and hard problems"]');
const everyday = () => host.querySelector<HTMLElement>('[data-row="Everyday answers"]');

describe("Settings › Models › Planning and hard problems (#1093)", () => {
  it("is absent at Regular and Advanced (Coming only at Technical)", async () => {
    await render(0);
    expect(everyday()).not.toBeNull();
    expect(planning()).toBeNull();
    expect(host.textContent).not.toContain(PLANNING_WHY);

    await render(1);
    expect(everyday()).not.toBeNull();
    expect(planning()).toBeNull();
    expect(host.textContent).not.toContain(PLANNING_WHY);
  });

  it("at Technical is greyed and names a visible Coming why with aria-describedby", async () => {
    await render(2);
    const row = planning();
    expect(row).not.toBeNull();
    expect(row!.className).toContain("off-k");
    expect(row!.getAttribute("aria-disabled")).toBe("true");
    expect(row!.textContent).toContain(PLANNING_WHY);
    expect(PLANNING_WHY).toMatch(/later update/i);

    const why = row!.querySelector("small.why-k") ?? [...row!.querySelectorAll("small")].find((s) => s.textContent?.includes("later update"));
    expect(why, "visible why line").toBeTruthy();
    expect(why!.textContent?.trim()).toBe(PLANNING_WHY);

    const controls = [...row!.querySelectorAll<HTMLElement>("button, [role=switch]")];
    expect(controls.length).toBeGreaterThan(0);
    for (const el of controls) {
      expect(el.getAttribute("aria-describedby")).toBe(why!.id);
    }
    // Everyday answers still draws (working neighbour).
    expect(everyday()).not.toBeNull();
    expect(everyday()!.className).not.toContain("off-k");
  });

  it("lists Planning in the search index at Technical only", () => {
    const hits = MODELS_ROWS.filter((r) => r.title === "Planning and hard problems");
    expect(hits).toEqual([{ page: "models", title: "Planning and hard problems", sec: "Defaults", group: "Defaults", lv: 2 }]);
  });
});
