// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { SelfPage } from "./self";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function show(health: unknown, memory: unknown = {}) {
  const engine: WindowEngine = {
    request: (async (method: string) => {
      const result = method === "health" ? health : method === "doctor.memory.status" ? memory
        : method === "config.get" ? { hash: "h", config: {}, valid: true } : {};
      if (result instanceof Error) throw result;
      return result;
    }) as WindowEngine["request"],
    onEvent: () => () => undefined, sessionKey: "test", scopes: [],
  };
  await act(async () => root.render(<SelfPage page="self" title="Branch itself" level="regular" engine={engine} />));
  const check = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Check and fix");
  if (!check) throw new Error("Check button missing");
  await act(async () => check.click());
  return [...document.querySelectorAll<HTMLLIElement>(".s2-tl li")];
}

describe("Branch itself diagnostics", () => {
  it("does not call an incomplete health or embedding result successful", async () => {
    const rows = await show({ ts: 123 }, { embedding: {} });
    expect(host.textContent).toContain("Engine health not reported");
    expect(rows.map((r) => r.textContent)).toEqual(["The engineHealth not reported", "Memory searchHealth not reported"]);
    expect(rows.every((r) => !r.classList.contains("ok"))).toBe(true);
  });
  it("reports native failures and preserves memory transport errors", async () => {
    const rows = await show({ ok: false }, new Error("Memory unavailable"));
    expect(host.textContent).toContain("The engine needs attention");
    expect(rows[0].textContent).toContain("Health check failed");
    expect(rows[1].textContent).toContain("Memory unavailable");
    expect(rows.every((r) => r.classList.contains("bad"))).toBe(true);
  });
  it("keeps the native skipped embedding probe neutral", async () => {
    const rows = await show({ ok: true }, { embedding: {
      ok: false, checked: false, error: "memory embedding readiness not checked; run doctor with a probe",
    } });
    expect(rows[1].textContent).toBe("Memory searchNot checked");
    expect(rows[1].classList.contains("bad")).toBe(false);
    expect(rows[1].classList.contains("ok")).toBe(false);
  });
  it("keeps disconnected chat rows neutral while confirmed checks succeed", async () => {
    const rows = await show({ ok: true, channels: { telegram: { connected: false } } }, { embedding: { ok: true } });
    expect(rows[0].classList.contains("ok")).toBe(true);
    expect(rows[1].textContent).toContain("Not connected");
    expect(rows[1].classList.contains("ok")).toBe(false);
    expect(rows[2].textContent).toContain("Working");
    expect(rows[2].classList.contains("ok")).toBe(true);
  });
});
