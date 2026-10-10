// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { MoreBody } from "./more-step";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function merge(into: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...into };
  for (const [key, value] of Object.entries(patch)) {
    const prev = out[key];
    out[key] =
      prev && typeof prev === "object" && !Array.isArray(prev) && value && typeof value === "object" && !Array.isArray(value)
        ? merge(prev as Record<string, unknown>, value as Record<string, unknown>)
        : value;
  }
  return out;
}

function catalogs(config: Record<string, unknown>, plugins: { id: string; installed: boolean }[]) {
  let snap = { hash: "h", config };
  const request = vi.fn(async (method: string, args?: unknown) => {
    if (method === "plugins.list") return { plugins };
    if (method === "config.get") return structuredClone(snap);
    if (method === "config.patch") {
      const raw = JSON.parse(String((args as { raw: string }).raw)) as Record<string, unknown>;
      snap = { hash: "h2", config: merge(snap.config, raw) };
      return { ok: true };
    }
    if (method === "migrations.memory.plan") return { providers: [] };
    return {};
  });
  const engine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "k", scopes: ["operator.admin"], agentId: "main" } as WindowEngine;
  return { engine, request, current: () => snap.config };
}

function patched(request: ReturnType<typeof vi.fn>) {
  return request.mock.calls.filter((c) => c[0] === "config.patch").map((c) => JSON.parse(String((c[1] as { raw: string }).raw)));
}

async function show(engine: WindowEngine) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<MoreBody engine={engine} agentId="main" trunkName="Sapling" />));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

const box = (host: HTMLElement) => host.querySelector('[data-testid="setup-otherconv"]') as HTMLInputElement;
const INSTALLED = [
  { id: "anthropic", installed: true },
  { id: "codex", installed: true },
];

describe("setup › Also show their conversations", () => {
  it("With installed catalogs and no saved preference, the checkbox renders unticked", async () => {
    const { engine } = catalogs({}, INSTALLED);
    const host = await show(engine);
    expect(box(host).checked).toBe(false);
    expect(box(host).disabled).toBe(false);
  });

  it("Ticking writes enabled: true for each installed catalog; leaving unticked writes enabled: false only for catalogs without a saved preference", async () => {
    const { engine, request } = catalogs({}, INSTALLED);
    const host = await show(engine);
    expect(patched(request)).toEqual([
      { plugins: { entries: { anthropic: { config: { sessionCatalog: { enabled: false } } }, codex: { config: { sessionCatalog: { enabled: false } } } } } },
    ]);
    await act(async () => box(host).click());
    await act(async () => new Promise((r) => setTimeout(r, 0)));
    expect(patched(request).at(-1)).toEqual({
      plugins: { entries: { anthropic: { config: { sessionCatalog: { enabled: true } } }, codex: { config: { sessionCatalog: { enabled: true } } } } },
    });

    if (root) await act(async () => root?.unmount());
    root = undefined;
    document.body.innerHTML = "";
    const mixed = catalogs(
      { plugins: { entries: { anthropic: { config: { sessionCatalog: { enabled: true } } } } } },
      INSTALLED,
    );
    const left = await show(mixed.engine);
    expect(box(left).checked).toBe(false);
    expect(patched(mixed.request)).toEqual([{ plugins: { entries: { codex: { config: { sessionCatalog: { enabled: false } } } } } }]);
    expect(JSON.stringify(patched(mixed.request))).not.toContain("anthropic");
  });
});
