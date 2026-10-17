// @vitest-environment jsdom
// Private #1093 item 7a: a control greyed by a real condition says what to do in one visible line, named by
// aria-describedby. A Coming control (a developer note or a "comes in a later update" stub) gets no such line: Coming
// shows only at Technical (#1701, rows.ts COMING_FROM), so Regular and Advanced never read "comes in a later update" here.
// B-022 project Edit, B-041 Double-check, B-043 Run, B-044 the data tools, B-062 Go to tiles, B-066 menu items.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { Menu } from "../../shell/Menu";
import { Ctl, KitProvider, Switch, type SaveReport } from "./kit";
import { SecondTab } from "./set1/models-tabs";
import { SettingsPage } from "./index";
import { placePages } from "../../screens/settings/pages/places-live";
import { ProjectList } from "../../screens/settings/pages/general-live";
import type { SlotControlProps } from "../../screens/settings/slots";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); host.className = "set-col"; document.body.append(host); root = createRoot(host); localStorage.clear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; localStorage.clear(); });
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const LEVELS = ["regular", "advanced"] as const;
function engineWith(answers: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => answers[method] ?? {});
  return { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"], features: { methods: [], events: [] } } as WindowEngine;
}
/** The visible line a control's aria-describedby names, or undefined. */
const describedBy = (el: Element | null | undefined) => {
  const id = el?.getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent ?? undefined : undefined;
};
const rowControl = (title: string) => host.querySelector(`[data-row="${title}"] .right`)?.querySelector("button, input, select, [role=switch]");
const projects = () => engineWith({ "projects.list": { projects: [{ id: "p1", displayName: "Garden" }] } });

describe("a settings row greyed by a real condition says what to do, visibly", () => {
  it("shows its plain reason in one line and names it with aria-describedby", async () => {
    await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><Ctl title="Quiet hours" off="Turn on notifications first."><Switch label="Quiet hours" checked={false} onChange={() => undefined} /></Ctl></KitProvider>));
    expect(describedBy(host.querySelector("input"))).toBe("Turn on notifications first.");
  });

  it("gives a Coming row (a developer note) no reason line, and never says 'comes in a later update' (B-041)", async () => {
    await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><SecondTab /></KitProvider>));
    const sw = host.querySelector<HTMLInputElement>('input[aria-label="Ask a second model on hard questions"]')!;
    expect(sw.closest(".ctl")?.getAttribute("aria-disabled")).toBe("true");
    expect(sw.getAttribute("aria-describedby")).toBeNull();
    expect(host.querySelector(".why-k")).toBeNull();
    expect(host.textContent).not.toContain("later update");
    expect(host.textContent).not.toContain("Branch has no setting for this yet.");
  });

  for (const level of LEVELS) {
    it(`Privacy & data at ${level}: condition reasons stay, and the Coming Run buttons are hidden (B-043, B-044)`, async () => {
      await act(async () => root.render(<SettingsPage page="usage" title="Privacy & data" level={level} engine={engineWith({ "config.get": { hash: "h", valid: true, config: {} } })} />));
      await flush();
      expect(describedBy(rowControl("Show other assistants’ conversations"))).toBe("No other assistants were found on this computer.");
      if (level === "advanced") expect(describedBy(rowControl("Run now"))).toBe("Turn on “Compress older transcripts” first.");
      // Test the model and Evals are Technical-only cards, so their Coming Run buttons don't show here at all.
      const runs = [...host.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent === "Run" || b.textContent === "Run the test");
      expect(runs).toEqual([]);
      expect(host.textContent).not.toContain("later update");
    });
  }
});

describe("a greyed menu item says why only for a real condition (B-066)", () => {
  it("shows a condition under the label, and no line for a Coming item", async () => {
    await act(async () => root.render(<Menu at={{ x: 0, y: 0 }} label="More" onClose={() => undefined} items={[
      { label: "Remove Trunk…", run: () => undefined, disabled: "Oak is your default Trunk." },
      { label: "Copy seed", run: () => undefined, disabled: "Copy seed comes in a later update." },
      { label: "Package…", run: () => undefined, disabled: "Needs the engine's package export." },
      { label: "Rename", run: () => undefined },
    ]} />));
    const rows = [...document.querySelectorAll<HTMLButtonElement>("button.mi")];
    expect(describedBy(rows[0])).toBe("Oak is your default Trunk.");
    expect(rows[0].textContent).toContain("Oak is your default Trunk.");
    for (const b of rows.slice(1)) expect(b.getAttribute("aria-describedby"), b.textContent ?? "").toBeNull();
    expect(rows[1].title).toBe("Copy seed comes in a later update.");
    expect(document.body.textContent).not.toContain("later update");
    expect(document.body.textContent).not.toContain("engine");
  });
});

describe("Coming controls are absent below Technical (B-022, B-062)", () => {
  for (const level of LEVELS) {
    it(`Go to has no Coming tile and no 'later update' text at ${level}`, async () => {
      localStorage.setItem("branch.level", level);
      const GoTo = placePages(vi.fn()).goto!.component!;
      await act(async () => root.render(<GoTo engine={engineWith()} onPage={() => undefined} />));
      await flush();
      expect(host.querySelectorAll("[data-tile]").length).toBe(0);
      expect(host.querySelectorAll("[data-place]").length).toBeGreaterThan(0);
      expect(host.textContent).not.toContain("later update");
    });

    it(`a project has no Edit button at ${level}`, async () => {
      localStorage.setItem("branch.level", level);
      await act(async () => root.render(<ProjectList {...({ engine: projects() } as unknown as SlotControlProps)} />));
      await flush();
      expect(host.querySelector("[data-project=p1]")?.textContent).toContain("Garden");
      expect(host.querySelector("[data-project=p1] button")).toBeNull();
      expect(host.textContent).not.toContain("later update");
    });
  }

  it("Technical shows the Coming tiles and project Edit, greyed, with no extra reason line", async () => {
    localStorage.setItem("branch.level", "technical");
    const GoTo = placePages(vi.fn()).goto!.component!;
    await act(async () => root.render(<GoTo engine={engineWith()} onPage={() => undefined} />));
    await flush();
    const tiles = [...host.querySelectorAll<HTMLElement>("[data-tile]")];
    expect(tiles.map((t) => t.dataset.tile)).toEqual(["harvest", "workshop", "computer"]);
    for (const tile of tiles) { expect(tile.getAttribute("aria-disabled")).toBe("true"); expect(tile.getAttribute("aria-describedby")).toBeNull(); }
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => root.render(<ProjectList {...({ engine: projects() } as unknown as SlotControlProps)} />));
    await flush();
    const edit = host.querySelector<HTMLButtonElement>("[data-project=p1] button")!;
    expect(edit.textContent).toBe("Edit");
    expect(edit.getAttribute("aria-disabled")).toBe("true");
    expect(edit.getAttribute("aria-describedby")).toBeNull();
  });
});
