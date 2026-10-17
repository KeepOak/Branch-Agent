// @vitest-environment jsdom
// Private #1093 item 1: "Saved" and a test's "Sent." never move the page. Each line is drawn from the first frame (so
// the live region is in place before it speaks) and the answer fills it in place: no row under the pointer moves.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../../../places/settings/kit";
import { NotificationsPage } from "../../../places/settings/set1/notifications";
import { ClassicHost } from "./classic-host";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("branch.level", "technical");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

const engine = () => ({ request: vi.fn(async () => ({})), onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"], features: { methods: [], events: [] } }) as unknown as WindowEngine;
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 50)); });
/** The page's layout boxes, in order: what a click lands on. */
const shape = (el: Element, skip = "") => [...el.querySelectorAll("*")].filter((n) => !skip || !n.closest(skip)).map((n) => n.tagName + "." + n.getAttribute("class"));
const css = readFileSync("src/screens/settings/pages/classic-host.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

it("a re-hosted page's Saved line takes no room: drawn from the first frame, out of flow, filled in place", async () => {
  await act(async () => root.render(<ClassicHost engine={engine()} page="permissions" classic="permissions" />));
  await settle();
  const line = host.querySelector<HTMLElement>(".r1s-classic-save")!;
  expect(line).not.toBeNull();
  expect(line.hidden).toBe(false);
  expect(line.getAttribute("role")).toBe("status");
  expect(line.getAttribute("aria-live")).toBe("polite");
  expect(line.textContent).toBe("");
  // Out of flow: no height of its own, kept at the top of the page's scroller.
  const rule = /\.r1s-classic \.r1s-classic-save\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  expect(rule).toMatch(/position:\s*sticky/);
  expect(rule).toMatch(/height:\s*0[;\s]/);
  expect(rule).toMatch(/margin:\s*0[;\s]/);
  const col = host.querySelector(".set-col")!;
  const before = shape(col, ".r1s-classic-save");
  const choice = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.getAttribute("aria-checked") !== "true" && !b.disabled);
  expect(choice).toBeTruthy();
  await act(async () => { choice!.click(); });
  await settle();
  expect(host.querySelector(".r1s-classic-save")).toBe(line);
  expect(line.textContent).toMatch(/Saved|Saving…|Not saved/);
  expect(line.querySelector(".r1s-classic-save-pill")).not.toBeNull();
  // Nothing else on the page was added or moved in the flow.
  expect(shape(col, ".r1s-classic-save")).toEqual(before);
});

it("Send test keeps its answer line from the first frame, so \"Sent\" fills it without growing the row", async () => {
  const request = vi.fn(async (method: string) => (method === "push.web.test" ? { results: [{ ok: true }] } : method === "users.prefs.get" ? { status: "ok", entries: {} } : {}));
  const report: SaveReport = { saving() {}, saved() {}, failed() {} };
  await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><NotificationsPage page="notifications" title="Notifications" level="regular" engine={{ request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine} /></KitProvider>));
  await settle();
  const row = host.querySelector<HTMLElement>('[data-row="Send a test notification"]')!;
  expect(row).not.toBeNull();
  const said = row.querySelector<HTMLElement>('[role="status"]')!;
  expect(said).not.toBeNull();
  expect(said.getAttribute("aria-live")).toBe("polite");
  expect(said.textContent!.trim()).toBe("");
  const before = shape(row);
  const send = [...row.querySelectorAll("button")].find((b) => b.textContent === "Send test")!;
  await act(async () => { send.click(); });
  await settle();
  expect(row.querySelector('[role="status"]')).toBe(said);
  expect(said.textContent).toBe("Sent to 1 device.");
  expect(shape(row)).toEqual(before);
});
