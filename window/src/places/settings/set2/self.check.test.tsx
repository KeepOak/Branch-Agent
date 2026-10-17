// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SelfPage } from "./self";

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function show(level: "regular" | "advanced" = "regular", health: unknown = { ok: true }, memory: unknown = { embedding: { ok: true } }, openSettings?: (page: string) => void) {
  const request = vi.fn(async (method: string) => {
    const reply = method === "health" ? health : method === "doctor.memory.status" ? memory : {};
    if (reply instanceof Error) throw reply;
    return reply;
  });
  const engine = { request, onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as WindowEngine;
  await act(async () => root.render(<SelfPage page="self" engine={engine} title="Branch itself" level={level} openSettings={openSettings} />));
  const button = [...host.querySelectorAll("button")].find(b => b.textContent === "Check Branch");
  expect(button).toBeDefined();
  await act(async () => button!.click());
  return request;
}
it("checks Branch without terminal instructions in Regular", async () => {
  const request = await show();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Branch is responding.");
  expect(document.body.textContent).not.toContain("branch doctor");
  expect(dialog.querySelector("code")).toBeNull();
  expect(request).toHaveBeenCalledWith("health", { probe: false });
  expect(request).toHaveBeenCalledWith("doctor.memory.status", {});
  expect(request.mock.calls.some(([method]) => method.includes("fix"))).toBe(false);
});
it("keeps terminal checks and repairs in Advanced", async () => {
  await show("advanced");
  expect(host.textContent).toContain("branch doctor --fix");
  expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("branch doctor");
});
it("shows failed checks in plain language without leaking terminal instructions", async () => {
  await show("regular", new Error("run branch doctor --fix"), new Error("transport failed"));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Branch couldn’t be checked. Close this window and try again.");
  expect(dialog.textContent).toContain("Memory search couldn’t be checked.");
  expect(document.body.textContent).not.toContain("branch doctor");
});
it("shows a plain memory search error when no local embedding model is available", async () => {
  const openSettings = vi.fn();
  await show("regular", { ok: true }, { embedding: { ok: false, checked: true, error: "Search by meaning is off until this computer has the small model that powers it. Branch still finds memories by matching words." } }, openSettings);
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Search by meaning is off until this computer has the small model that powers it. Branch still finds memories by matching words.");
  expect(dialog.textContent).not.toContain("Settings › Advanced");
  const button = [...dialog.querySelectorAll("button")].find(b => b.textContent === "Set it up");
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(openSettings).toHaveBeenCalledWith("advanced");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("does not claim skipped memory checks worked", async () => {
  await show("regular", { ok: true }, { embedding: { ok: true, checked: false } });
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Memory search was not checked.");
});

it("keeps pending checks neutral until their responses arrive", async () => {
  let resolveHealth!: (value: unknown) => void;
  const health = new Promise(resolve => { resolveHealth = resolve; });
  await show("regular", health, {});
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Checking Branch…");
  expect(dialog.textContent).toContain("Memory search did not report a result.");
  expect(dialog.querySelector("li.ok")).toBeNull();
  await act(async () => resolveHealth({ ok: true }));
  expect(dialog.textContent).toContain("Branch is responding.");
});
