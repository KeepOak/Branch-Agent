// @vitest-environment jsdom
// Private #1093 item 7a: every greyed control says why in one visible line, named by aria-describedby. A reason that is a
// developer note (shownWhy hides it) becomes the repo's "<label> comes in a later update." instead of nothing.
// B-022 project Edit, B-041 Double-check and Media, B-043 Run, B-044 the data tools, B-062 Go to tiles, B-066 menu items.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { Menu } from "../../shell/Menu";
import { Ctl, KitProvider, laterWhy, Switch, type SaveReport } from "./kit";
import { SecondTab } from "./set1/models-tabs";
import { SettingsPage } from "./index";
import { Coming } from "../../glass/coming";
import { placePages } from "../../screens/settings/pages/places-live";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLDivElement;
beforeEach(() => { host = document.createElement("div"); host.className = "set-col"; document.body.append(host); root = createRoot(host); localStorage.clear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; localStorage.clear(); });
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
function engineWith(answers: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => answers[method] ?? {});
  return { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"], features: { methods: [], events: [] } } as WindowEngine;
}
/** Every greyed control on the page, and the visible line its aria-describedby names (or why it has none). */
function greyed(scope: ParentNode = document) {
  return [...scope.querySelectorAll<HTMLElement>("button:disabled, input:disabled, select:disabled, [aria-disabled=true]:not(.ctl)")].map((el) => {
    const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    const lines = ids.map((id) => document.getElementById(id)).filter((n): n is HTMLElement => Boolean(n));
    return { name: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName, why: lines.map((n) => n.textContent?.trim() ?? "").join(" ") };
  });
}

describe("a greyed settings row says why, visibly", () => {
  it("turns a developer note into '<label> comes in a later update.' and names it from the control (B-041)", async () => {
    await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><SecondTab /></KitProvider>));
    const sw = host.querySelector<HTMLInputElement>('input[aria-label="Ask a second model on hard questions"]')!;
    const line = document.getElementById(sw.getAttribute("aria-describedby") ?? "")!;
    expect(line.textContent).toBe("Ask a second model on hard questions comes in a later update.");
    expect(host.textContent).not.toContain("Branch has no setting for this yet.");
  });

  it("keeps a plain reason as it is", async () => {
    await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><Ctl title="Quiet hours" off="Turn on notifications first."><Switch label="Quiet hours" checked={false} onChange={() => undefined} /></Ctl></KitProvider>));
    const sw = host.querySelector<HTMLInputElement>("input")!;
    expect(document.getElementById(sw.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Turn on notifications first.");
    expect(laterWhy("Share to Seedbank…")).toBe("Share to Seedbank comes in a later update.");
  });

  it("every greyed control on Privacy & data's data tools and test runs has a visible reason (B-043, B-044)", async () => {
    await act(async () => root.render(<SettingsPage page="usage" title="Privacy & data" level="advanced" engine={engineWith({ "config.get": { hash: "h", valid: true, config: {} } })} />));
    await flush();
    const missing = greyed(host).filter((g) => !g.why);
    expect(missing).toEqual([]);
    expect(host.textContent).toContain("Export everything comes in a later update.");
    expect(host.textContent).toContain("Running a test set comes in a later update.");
  });
});

describe("a greyed menu item says why, visibly (B-066)", () => {
  it("shows its reason under the label and names it with aria-describedby", async () => {
    await act(async () => root.render(<Menu at={{ x: 0, y: 0 }} label="More" onClose={() => undefined} items={[
      { label: "Copy seed", run: () => undefined, disabled: "Copy seed comes in a later update." },
      { label: "Package…", run: () => undefined, disabled: "Needs the engine's package export." },
      { label: "Rename", run: () => undefined },
    ]} />));
    const rows = [...document.querySelectorAll<HTMLButtonElement>("button.mi")];
    const why = (b: HTMLButtonElement) => document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent;
    expect(why(rows[0])).toBe("Copy seed comes in a later update.");
    expect(why(rows[1])).toBe("Package comes in a later update.");
    expect(rows[1].textContent).not.toContain("engine");
    expect(rows[2].getAttribute("aria-describedby")).toBeNull();
  });
});

describe("a Coming control can say why, visibly (B-022, B-062)", () => {
  it("draws the reason after the control and names it", async () => {
    await act(async () => root.render(<Coming need="x.y" unwired show reason="Editing a project’s own instructions comes in a later update."><button type="button">Edit</button></Coming>));
    const edit = host.querySelector("button")!;
    expect(edit.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(edit.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Editing a project’s own instructions comes in a later update.");
  });

  it("Go to's Coming tiles each say why under them", async () => {
    localStorage.setItem("branch.level", "technical");
    const GoTo = placePages(vi.fn()).goto!.component!;
    await act(async () => root.render(<GoTo engine={engineWith()} onPage={() => undefined} />));
    await flush();
    const tiles = [...host.querySelectorAll<HTMLElement>("[data-tile]")];
    expect(tiles.map((t) => t.dataset.tile)).toEqual(["harvest", "workshop", "computer"]);
    for (const tile of tiles) expect(document.getElementById(tile.getAttribute("aria-describedby") ?? "")?.textContent, tile.dataset.tile).toMatch(/ comes in a later update\.$/);
  });
});
