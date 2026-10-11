// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KitProvider, type SaveReport } from "../kit";
import { EachPerson, separate } from "./people-more";
import type { Roles } from "./people-data";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const empty: Roles = { names: [], defs: {} };
const hidden: Roles = { names: ["Adult"], defs: { Adult: { sessions: { others: "none" } } } };
const granted: Roles = { names: ["Staff"], defs: { Staff: { sessions: { others: "view" } } } };
const unset: Roles = { names: ["Guest"], defs: { Guest: { sessions: {} } } };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

const report: SaveReport = { saving: () => undefined, saved: () => undefined, failed: () => undefined };

describe("Settings › People › Keep conversations separate", () => {
  it("separate() with no roles is on", () => {
    expect(separate(empty)).toBe(true);
  });

  it("separate() is on when every role sets sessions.others to none", () => {
    expect(separate(hidden)).toBe(true);
  });

  it("separate() is off when a role grants others' sessions", () => {
    expect(separate(granted)).toBe(false);
    expect(separate({ names: ["Staff", "Adult"], defs: { ...granted.defs, ...hidden.defs } })).toBe(false);
  });

  it("separate() is off when a role leaves sessions.others unset", () => {
    expect(separate(unset)).toBe(false);
  });

  it("Open People is the explicit way out of Settings › People", async () => {
    const left: unknown[] = [];
    const onLeave = (event: Event) => left.push((event as CustomEvent).detail);
    window.addEventListener("branch:navigate-place", onLeave);
    try {
      await act(async () => root.render(
        <KitProvider level={0} report={report} scope={null}>
          <EachPerson roles={empty} />
        </KitProvider>,
      ));
      expect(host.querySelector('[data-row="Open People"]')).not.toBeNull();
      expect(left).toEqual([]);
      await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Open People")!.click());
      expect(left).toEqual([{ place: "people" }]);
    } finally {
      window.removeEventListener("branch:navigate-place", onLeave);
    }
  });

  it("EachPerson renders the switch checked on an empty roles list", async () => {
    await act(async () => root.render(
      <KitProvider level={0} report={report} scope={null}>
        <EachPerson roles={empty} />
      </KitProvider>,
    ));
    const sw = host.querySelector<HTMLInputElement>('input[aria-label="Keep conversations separate"]');
    expect(sw?.checked).toBe(true);
    expect(host.querySelector('[data-row="Keep conversations separate"]')?.getAttribute("aria-disabled")).toBe("true");
  });
});
