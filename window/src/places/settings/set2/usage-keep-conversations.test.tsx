// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { UsagePage } from "./usage";

type Answers = Record<string, unknown | ((params: Record<string, unknown>) => unknown)>;
function engineWith(answers: Answers) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const a = answers[method];
    if (a instanceof Error) throw a;
    if (a === undefined) return {};
    return typeof a === "function" ? (a as (p: Record<string, unknown>) => unknown)(params) : a;
  });
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] };
  return { engine, request };
}
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); host.className = "set-col"; document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
async function show(engine: WindowEngine) {
  await act(async () => root.render(<UsagePage page="usage" title="Data & usage" level="regular" engine={engine} />));
  await flush();
}
function button(text: string, scope: ParentNode = document): HTMLButtonElement {
  const b = [...scope.querySelectorAll("button")].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b as HTMLButtonElement;
}
const row = (title: string) => document.querySelector(`[data-row="${title}"]`);
const patched = (request: ReturnType<typeof vi.fn>) => request.mock.calls.filter(([m]) => m === "config.patch").map(([, p]) => JSON.parse(String((p as { raw: string }).raw)) as unknown);

const BASE: Answers = {
  "sessions.usage": { totals: {}, aggregates: { messages: {}, byAgent: [] } },
  "usage.status": { providers: [] },
  "agents.list": { agents: [] },
  "plugins.list": { plugins: [] },
};
const CFG = (config: Record<string, unknown> = {}): Answers => ({ "config.get": { hash: "h", valid: true, config }, "config.patch": { ok: true, hash: "h2", config } });

describe("Settings › Data & usage › Keep conversations", () => {
  it("shows Forever when the config has no session.maintenance", async () => {
    const { engine } = engineWith({ ...BASE, ...CFG() });
    await show(engine);
    const keep = row("Keep conversations")!;
    expect(button("Forever", keep).getAttribute("aria-pressed")).toBe("true");
    expect(button("30 days", keep).getAttribute("aria-pressed")).toBe("false");
    expect(keep.textContent).toContain("Older ones are deleted for good.");
    expect(keep.textContent).not.toContain("Now:");
  });

  it("shows 1 year from an enforced 365-day pruneAfter", async () => {
    const { engine } = engineWith({ ...BASE, ...CFG({ session: { maintenance: { mode: "enforce", pruneAfter: "365d" } } }) });
    await show(engine);
    expect(button("1 year", row("Keep conversations")!).getAttribute("aria-pressed")).toBe("true");
  });

  it("writes pruneAfter 30d when choosing 30 days", async () => {
    const { engine, request } = engineWith({ ...BASE, ...CFG({ session: { maintenance: { mode: "enforce", pruneAfter: "365d" } } }) });
    await show(engine);
    await act(async () => button("30 days", row("Keep conversations")!).click());
    await flush();
    expect(patched(request)).toContainEqual({ session: { maintenance: { mode: "enforce", pruneAfter: "30d" } } });
  });
});
