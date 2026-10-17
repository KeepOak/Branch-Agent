// @vitest-environment jsdom
// Private #1093 item 6: Settings is one clear place. At Regular the other pages of a Regular page sit under "Also in
// <page>", not a stray "Advanced" heading; the nav stays in view on a long page; and a card a slot page adds after
// its re-hosted Classic page (Town lookup, Approvals) keeps the page's column instead of spilling to the frame's width.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { R1_PAGES } from "./pages/plugged";
import { SettingsFrame } from "./SettingsFrame";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const engine = () => ({ request: vi.fn(async () => ({})), onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: [], events: [] } }) as unknown as WindowEngine;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
const css = readFileSync("src/screens/settings/settings.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** Every declaration block for exactly this selector, joined. */
const rule = (selector: string) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => sel.split(",").map((s) => s.trim()).includes(selector)).map(([, , body]) => body).join(";");

it("at Regular, a page's other pages sit under 'Also in <page>', not a stray Advanced heading", async () => {
  localStorage.setItem("branch.level", "regular");
  await act(async () => root.render(<SettingsFrame engine={engine()} page="general" pages={R1_PAGES} />));
  await settle();
  const more = host.querySelector<HTMLElement>(".r1s-advanced")!;
  expect(more).not.toBeNull();
  expect(more.querySelector("h2")?.textContent).toBe("Also in General");
  expect(more.getAttribute("aria-label")).toBe("Also in General");
  expect(more.querySelector('[data-page="card"]')).not.toBeNull();
});

it("the nav stays in view when a long page scrolls the frame", () => {
  const side = rule(".r1s-side");
  expect(side).toMatch(/position:\s*sticky/);
  expect(side).toMatch(/top:\s*0/);
  expect(side).toMatch(/overflow-y:\s*auto/);
});

it("the nav is capped at the Settings frame, not the viewport, so its last rows stay reachable", () => {
  // The frame sits under the window chrome and clips what runs past it (frame/frame.css), so a viewport cap (100vh)
  // makes the nav taller than its pane. The cap is the frame's own height: 100% of the nav's grid row.
  const side = rule(".r1s-side");
  const caps = [...side.matchAll(/max-height:\s*([^;]+)/g)].map(([, v]) => v.trim());
  expect(caps.length).toBeGreaterThan(0);
  for (const cap of caps) {
    expect(cap).toBe("100%");
    expect(cap).not.toMatch(/v(h|min|max)|dvh|svh|lvh/);
  }
  expect(rule(".r1set")).toMatch(/height:\s*100%/);
});

it("Town lookup and Approvals keep the page's column", async () => {
  const col = rule(".r1s-custom > .r1s-sec");
  expect(col).toMatch(/max-width:\s*820px/);
  expect(col).toMatch(/margin:\s*0 auto/);
  expect(col).toMatch(/padding:\s*4px 32px/);
  localStorage.setItem("branch.level", "technical");
  await act(async () => root.render(<SettingsFrame engine={engine()} page="privacy" pages={R1_PAGES} />));
  await settle();
  const town = host.querySelector('.r1s-custom[data-slot="privacy"] > .r1s-sec[aria-label="Town lookup"]');
  expect(town).not.toBeNull();
  await act(async () => root.render(<SettingsFrame engine={engine()} page="permissions" pages={R1_PAGES} />));
  await settle();
  expect(host.querySelector('.r1s-custom[data-slot="permissions"] > .r1s-sec[aria-label="Approvals"]')).not.toBeNull();
});
