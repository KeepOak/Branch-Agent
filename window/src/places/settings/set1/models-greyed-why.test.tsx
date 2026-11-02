// @vitest-environment jsdom
// Settings › Models at Regular and Advanced: every greyed row says why on a visible line. The Budgets rows
// (Most steps in one task, Spend cap per task) and the other greyed rows used a developer note that shownWhy
// strips, so they were greyed with nothing said.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { isComingWhy, isDevNote } from "../../../shell/shown-why";
import { KitProvider, type SaveReport } from "../kit";
import { ModelsPage } from "./models";
import { FIXED_WHY, NOT_OPEN_WHY, SPEND_WHY, STEPS_WHY } from "./models-more";

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

async function render(level: 0 | 1, tab: string) {
  const config = {
    agents: {
      defaults: { model: { primary: "local/main", fallbacks: ["local/spare"] } },
      entries: {},
    },
  };
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
  const engine = {
    request,
    onEvent: () => () => undefined,
    sessionKey: "s",
    scopes: [],
  } as unknown as WindowEngine;
  await act(async () =>
    root.render(
      <KitProvider level={level} report={report} scope={null}>
        <ModelsPage
          page="models"
          title="Models"
          level={level ? "advanced" : "regular"}
          engine={engine}
          tab={tab}
        />
      </KitProvider>,
    ),
  );
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const row = (title: string) => host.querySelector<HTMLElement>(`[data-row="${title}"]`);
/** The visible line a greyed row names with aria-describedby (CtlRow gives it an id only when a reason shows). */
const whyOf = (el: HTMLElement) =>
  el.querySelector<HTMLElement>("small[id]")?.textContent?.trim() ?? "";

describe("Settings › Models: greyed rows say why at Regular and Advanced", () => {
  it("Budgets › Most steps in one task and Spend cap per task show their reason at Advanced", async () => {
    await render(1, "defaults");
    const steps = row("Most steps in one task");
    const spend = row("Spend cap per task");
    expect(steps?.getAttribute("aria-disabled")).toBe("true");
    expect(spend?.getAttribute("aria-disabled")).toBe("true");
    expect(whyOf(steps!)).toBe(STEPS_WHY);
    expect(whyOf(spend!)).toBe(SPEND_WHY);
    const field = steps!.querySelector<HTMLElement>("input");
    expect(field?.getAttribute("aria-describedby")).toBe(steps!.querySelector("small[id]")!.id);
  });

  for (const level of [0, 1] as const) {
    for (const tab of ["defaults", "second", "media"]) {
      it(`every greyed row on the ${tab} tab at level ${level} has a visible reason`, async () => {
        await render(level, tab);
        const greyed = [...host.querySelectorAll<HTMLElement>(".ctl.off-k")];
        if (level === 1) expect(greyed.length).toBeGreaterThan(10);
        const silent = greyed.filter((el) => !whyOf(el)).map((el) => el.dataset.row);
        expect(silent).toEqual([]);
      });
    }
  }

  it("the reasons are plain copy that stays visible (not a developer note, not Coming)", () => {
    for (const why of [STEPS_WHY, SPEND_WHY, FIXED_WHY, NOT_OPEN_WHY]) {
      expect(isDevNote(why)).toBe(false);
      expect(isComingWhy(why)).toBe(false);
      expect(why).not.toMatch(/\u2014|#\d/);
    }
  });
});
