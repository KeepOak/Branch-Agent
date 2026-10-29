// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { appOf } from "./chatapps-data";
import { ManageDialog } from "./chatapps-manage";

// These panels are owned by other files; exercise the controls owned by ManageDialog here.
vi.mock("./chatapps-who", () => ({ WhoSeg: () => null }));
vi.mock("./chatapps-manage-more", () => ({ ManageMore: () => null }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
afterEach(async () => { if (root) await act(async () => root.unmount()); document.body.innerHTML = ""; });
async function render(loading = false) {
  const request = vi.fn(async () => ({}));
  const engine = { request, onEvent: () => () => {}, scopes: ["operator.admin"], features: { methods: [], events: [] } } as unknown as WindowEngine;
  const app = appOf({ channelAccounts: { telegram: [{ accountId: "default", configured: true, running: false, linked: false, allowFrom: ["someone"] }] } }, { id: "telegram", name: "Telegram", detail: "" });
  const set = vi.fn(async () => true), onSetup = vi.fn();
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(<ManageDialog engine={engine} app={app} cfg={{ loading, get: () => undefined, set }} trunks={[]} defaultId="main" reload={async () => {}} onReview={() => {}} onPerChat={() => {}} onSetup={onSetup} onClose={() => {}} />));
  return { request, set, onSetup };
}
function reasonFor(control: Element) {
  const ids = control.getAttribute("aria-describedby")?.split(/\s+/) ?? [];
  const lines = ids.map(id => document.getElementById(id));
  // Radio choices have their reason directly inside the button.
  if (!lines.length) lines.push(control.querySelector("small"));
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line?.textContent?.trim(), control.textContent ?? "control").toBeTruthy();
    expect(line?.closest("[hidden], [aria-hidden=true]")).toBeNull();
  }
  return lines.map(line => line!.textContent).join(" ");
}
it("describes all five greyed setup labels and points to Back", async () => {
  const { onSetup } = await render();
  const steps = [...document.querySelectorAll(".chw-steps12 > span")];
  expect(steps.map(step => step.textContent)).toEqual(["1Create", "2Paste", "3Check", "4Pair", "5Save"]);
  for (const step of steps) {
    expect(reasonFor(step)).toBe("These are setup progress labels. Use Back to open the setup steps.");
    expect(step.querySelector("button")).toBeNull();
  }
  const back = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Back")!;
  await act(async () => back.click());
  expect(onSetup).toHaveBeenCalledOnce();
});
it.each([false, true])("gives every disabled Manage button a visible or described reason (loading=%s)", async loading => {
  const { request, set } = await render(loading);
  const controls = [...document.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>("button:disabled, select:disabled, input:disabled")];
  expect(controls.length).toBeGreaterThan(5);
  for (const control of controls) {
    reasonFor(control);
    await act(async () => control.click());
  }
  expect(request).not.toHaveBeenCalled();
  expect(set).not.toHaveBeenCalled();
});
