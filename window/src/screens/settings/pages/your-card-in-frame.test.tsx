// @vitest-environment jsdom
// Private #1093 item 6: Settings is one place. "Your card" opens inside the one R1 Settings frame (its nav, search and
// "How much to show"), instead of the Classic frame with its own nav and "Settings for" picker. It is the native R1
// page (card-live.tsx) with the approved preview's rows, not Classic People re-hosted.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { CLASSIC_PAGE, r1SettingsPage } from "../../frame/R1Window";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES, REHOSTED } from "./plugged";

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

const engine = () => ({ request: vi.fn(async (method: string) => (method === "users.self" ? { profile: { id: "gateway-owner", displayName: "Taofik" } } : {})), onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: [], events: [] } }) as unknown as WindowEngine;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
const rows = (el: ParentNode) => [...el.querySelectorAll<HTMLElement>("[data-row]")].map((r) => r.dataset.row);

it("Your card is an R1 Settings page, not the Classic frame", () => {
  expect(r1SettingsPage("card", R1_PAGES)).toBe(true);
  expect(CLASSIC_PAGE.card).toBeUndefined();
  expect(Object.keys(REHOSTED)).not.toContain("card");
});

it("draws Your card in the R1 frame as the preview's native rows, and no Classic People, second nav or Settings for picker", async () => {
  await act(async () => root.render(<SettingsFrame engine={engine()} page="card" pages={R1_PAGES} />));
  await settle();
  expect([...host.querySelectorAll(".r1s-sec > h2")].map((h) => h.textContent)).toEqual(["Your card"]);
  expect(rows(host)).toEqual(["card.card.name", "card.card.picture", "card.card.see"]);
  expect(host.querySelector('[data-row="card.card.name"]')!.textContent).toContain("Taofik");
  expect(host.querySelector('.r1s-classic[data-classic="people"]')).toBeNull();
  // One frame: no Classic nav, no "Back to", no "Settings for".
  expect(host.querySelector(".set-nav")).toBeNull();
  expect(host.querySelector('select[aria-label="Settings for"]')).toBeNull();
  expect(host.textContent).not.toContain("Settings for");
});
