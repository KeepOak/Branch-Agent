// @vitest-environment jsdom
// Private #1093 item 6: Settings is one place. "Your card" opens inside the one R1 Settings frame (its nav, search and
// "How much to show"), re-hosting Classic People's controls, instead of the Classic frame with its own nav and
// "Settings for" picker. Nothing on the card is left behind: every Classic People section and row is drawn.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SettingsPage } from "../../../places/settings";
import { KitProvider } from "../../../places/settings/kit";
import { CLASSIC_PAGE, r1SettingsPage } from "../../frame/R1Window";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("branch.level", "regular");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const engine = () => ({ request: vi.fn(async () => ({})), onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: [], events: [] } }) as unknown as WindowEngine;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
const rows = (el: ParentNode) => [...el.querySelectorAll<HTMLElement>("[data-row]")].map((r) => r.dataset.row);

it("Your card is an R1 Settings page, not the Classic frame", () => {
  expect(r1SettingsPage("card", R1_PAGES)).toBe(true);
  expect(CLASSIC_PAGE.card).toBeUndefined();
});

it("draws Your card in the R1 frame with every Classic People row, and no second nav or Settings for picker", async () => {
  await act(async () => root.render(<KitProvider level={0} report={{ saving() {}, saved() {}, failed() {} }} scope={null}><SettingsPage page="people" title="Classic" level="regular" engine={engine()} /></KitProvider>));
  await settle();
  const classic = rows(host);
  expect(classic.length).toBeGreaterThan(0);
  await act(async () => root.render(<SettingsFrame engine={engine()} page="card" pages={R1_PAGES} />));
  await settle();
  const hosted = host.querySelector<HTMLElement>('.r1s-custom[data-slot="card"] .r1s-classic[data-classic="people"]');
  expect(hosted).not.toBeNull();
  expect(rows(hosted!)).toEqual(expect.arrayContaining(classic));
  expect(hosted!.querySelector("h1")?.textContent).toBe("Your card");
  // One frame: no Classic nav, no "Back to", no "Settings for".
  expect(host.querySelector(".set-nav")).toBeNull();
  expect(host.querySelector('select[aria-label="Settings for"]')).toBeNull();
  expect(host.textContent).not.toContain("Settings for");
});
