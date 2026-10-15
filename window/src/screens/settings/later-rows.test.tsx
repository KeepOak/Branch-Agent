// @vitest-environment jsdom
// Later-update rows: Regular never shows them; Advanced folds each section's later-update rows into one line that
// opens them, so the rows never sit beside live controls as if they worked.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { forgetLookStore } from "../../places/settings/set1/appearance-store";
import { SettingsFrame } from "./SettingsFrame";
import { laterLine } from "./LaterRows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engine(): WindowEngine {
  const request = vi.fn(async (method: string) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "themes.list") return { current: {} };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"] } as unknown as WindowEngine;
}
async function mount(level: "regular" | "advanced") {
  await act(async () => root.render(<SettingsFrame engine={engine()} page="general" />));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const button = [...host.querySelectorAll<HTMLButtonElement>(".r1s-level button")].find((b) => b.textContent === (level === "regular" ? "Regular" : "Advanced"));
  await act(async () => { button?.click(); await new Promise((r) => setTimeout(r, 0)); });
}

describe("later-update rows fold at Advanced", () => {
  it("names the count in one plain line", () => {
    expect(laterLine(1)).toBe("1 more comes in a later update");
    expect(laterLine(12)).toBe("12 more come in a later update");
  });

  it("Regular shows no later-update rows and no fold line", async () => {
    await mount("regular");
    expect(host.querySelector("[data-later-rows]")).toBeNull();
  });

  it("Advanced folds each section's later-update rows into one line that opens them", async () => {
    await mount("advanced");
    const folds = [...host.querySelectorAll<HTMLElement>("[data-later-rows]")];
    expect(folds.length).toBeGreaterThan(0);
    for (const fold of folds) {
      const count = Number(fold.dataset.laterRows);
      const line = fold.querySelector<HTMLButtonElement>(".r1s-later-btn");
      expect(line?.textContent).toBe(laterLine(count));
      expect(line?.getAttribute("aria-expanded")).toBe("false");
      const body = fold.querySelector<HTMLElement>(":scope > div[hidden]");
      expect(body).not.toBeNull();
      expect(fold.querySelectorAll("[data-row][data-coming]").length).toBe(count);
      await act(async () => { line?.click(); });
      expect(line?.getAttribute("aria-expanded")).toBe("true");
      expect(fold.querySelector<HTMLElement>(":scope > div")?.hidden).toBe(false);
      await act(async () => { line?.click(); });
    }
  });

  it("a live row never sits inside the fold", async () => {
    await mount("advanced");
    for (const fold of host.querySelectorAll<HTMLElement>("[data-later-rows]")) {
      const rows = [...fold.querySelectorAll<HTMLElement>("[data-row]")];
      expect(rows.length).toBe(rows.filter((row) => row.dataset.coming !== undefined).length);
    }
  });
});
