// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { UsagePage } from "./usage";

declare global { var IS_REACT_ACT_ENVIRONMENT: boolean; }
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function show(windows: Record<string, unknown>[], billing: Record<string, unknown>[] = []) {
  const calls: string[] = [];
  const reply = JSON.stringify({
    updatedAt: 123, providers: [{ provider: "test-provider", displayName: "Test service", windows, billing }],
    agents: [], sessions: [], totals: {}, aggregates: { messages: {} }, plugins: [], hash: "fixture", valid: true, config: {},
  });
  // The transport boundary delivers JSON, including null for nonfinite server numbers.
  const engine: WindowEngine = {
    request: async (method) => { calls.push(method); return JSON.parse(reply); },
    onEvent: () => () => undefined, sessionKey: "test-session", scopes: [],
  };
  await act(async () => root.render(<UsagePage page="usage" title="Data & usage" level="regular" engine={engine} />));
  const row = host.querySelector('[data-provider="test-provider"]');
  if (!row) throw new Error("Native allowances row did not render");
  return { row, calls };
}

describe("native Data & usage quota presentation", () => {
  it.each([undefined, null, "0", false, NaN, Infinity, -Infinity])("does not render a full allowance for %s", async (usedPercent) => {
    const { row, calls } = await show([{ label: "5h", usedPercent }]);
    expect(row.textContent).toContain("Not published");
    expect(row.textContent).not.toContain("Measured");
    expect(row.textContent).not.toContain("100% left");
    expect(row.querySelector('[role="meter"]')).toBeNull();
    expect(calls.some((method) => method === "models.probe" || method === "config.patch")).toBe(false);
  });

  it("keeps an explicitly measured zero as a full allowance", async () => {
    const { row } = await show([{ label: "5h", usedPercent: 0 }]);
    expect(row.textContent).toContain("Measured");
    expect(row.textContent).toContain("100% left");
    expect(row.querySelector('[role="meter"]')?.getAttribute("aria-valuenow")).toBe("100");
  });

  it("renders a real window while omitting an unmeasured window", async () => {
    const { row } = await show([{ label: "5h" }, { label: "Week", usedPercent: 75 }]);
    expect(row.querySelectorAll('[role="meter"]')).toHaveLength(1);
    expect(row.textContent).toContain("25% left");
    expect(row.textContent).not.toContain("100% left");
  });

  it.each([undefined, null, "0", false, NaN, Infinity, -Infinity])("keeps serialized billing amount %s unknown", async (amount) => {
    const { row, calls } = await show([], [{ type: "balance", amount, unit: "USD" }]);
    expect(row.textContent).toContain("Not published");
    expect(row.textContent).toContain("Unknown");
    expect(row.textContent).not.toContain("Measured");
    expect(row.textContent).not.toContain("$0.00");
    expect(row.querySelector('[role="meter"]')).toBeNull();
    expect(calls.some((method) => method === "models.probe" || method === "config.patch")).toBe(false);
  });

  it("preserves an explicitly measured zero dollar balance", async () => {
    const { row } = await show([], [{ type: "balance", amount: 0, unit: "USD" }]);
    expect(row.textContent).toContain("Measured");
    expect(row.textContent).toContain("$0.00");
    expect(row.textContent).not.toContain("Unknown");
  });

  it("does not create a full budget meter from unknown usage", async () => {
    const { row } = await show([], [{ type: "budget", limit: 100, used: NaN, unit: "USD" }]);
    expect(row.textContent).toContain("Not published");
    expect(row.textContent).toContain("Unknown");
    expect(row.textContent).not.toContain("$0.00");
    expect(row.querySelector('[role="meter"]')).toBeNull();
  });

  it("preserves explicitly measured zero budget usage", async () => {
    const { row } = await show([], [{ type: "budget", limit: 100, used: 0, unit: "USD" }]);
    expect(row.textContent).toContain("Measured");
    expect(row.textContent).toContain("$0.00 of $100.00");
    expect(row.querySelector('[role="meter"]')?.getAttribute("aria-valuenow")).toBe("100");
  });
});
