// @vitest-environment jsdom
// Private #1089 (Linux pass, Regular): Customize › Agents and Toolsets showed the engine's raw words when a settings change
// failed (tool-kinds.tsx: the agent detail, the Toolsets head and a toolset's detail). They now read plain; Advanced keeps
// the exact words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { CustomizePlace } from "./index";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /unknown method|ECONNREFUSED|127\.0\.0\.1|ENOENT|\/home\/|\/app\/|TypeError|:\d+:\d+/;
const FAILURES = [
  "unknown method: config.patch",
  "connect ECONNREFUSED 127.0.0.1:18789",
  "ENOENT: no such file or directory, open '/home/me/.branch/branch.json'",
  "TypeError: Cannot read properties of undefined (reading 'path')\n    at runTool (/app/engine/dist/tools/run.js:41:12)",
];
const tool = (id: string, label: string) => ({ id, label, source: "core", defaultProfiles: ["full"] });
const CATALOG = { groups: [{ id: "web", label: "Web", source: "core", tools: [tool("web_search", "Web search")] }] };

let root: Root | null = null;
let host: HTMLDivElement;
beforeEach(() => localStorage.clear());
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; localStorage.clear(); });

/** Customize on one tab, where every settings change (config.patch) fails with `raw`. */
async function open(tab: "Agents" | "Toolsets", raw: string, level: Level = "regular") {
  const table: Record<string, unknown> = {
    "agents.list": { defaultId: "main", mainKey: "main", agents: [{ id: "main", name: "Scout" }] },
    "config.get": { hash: "h1", sourceConfig: {}, runtimeConfig: {} }, "tools.catalog": CATALOG, "skills.status": { skills: [] },
    "plugins.list": { plugins: [] }, "acpx.agents.list": { agents: [{ id: "codex", name: "Codex", runtimeId: "codex", installation: "installed", enabled: true }] },
    "skills.library.list": { entries: [] },
  };
  const request = vi.fn((method: string) => method === "config.patch" ? Promise.reject(new Error(raw)) : Promise.resolve(table[method] ?? { ok: true }));
  const engine = { request, onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<CustomizePlace engine={engine} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} openSettings={() => {}} level={level} />); });
  await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "customize", tab } })); });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}
async function flip(within: Element) {
  const sw = within.querySelector("[role=switch]") as HTMLElement | null;
  expect(sw).not.toBeNull();
  await act(async () => { sw!.click(); });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
}
const alerts = (within: Element) => [...within.querySelectorAll("[role=alert].cz-error")].map((a) => a.textContent ?? "");

describe("Customize tool lines never show a raw engine error at Regular (Private #1089)", () => {
  it.each(FAILURES)("an agent's detail: %j", async (raw) => {
    await open("Agents", raw);
    const detail = host.querySelector("[data-testid=agent-detail]")!;
    expect(detail).not.toBeNull();
    await flip(detail);
    expect(alerts(detail).length).toBeGreaterThan(0);
    for (const line of alerts(detail)) expect(line).not.toMatch(RAW);
  });
  it.each(FAILURES)("the Toolsets list and a toolset's detail: %j", async (raw) => {
    await open("Toolsets", raw);
    await flip(host.querySelector("[data-toolset=web]")!);
    const detail = host.querySelector("[data-testid=toolset-detail]")!;
    expect(alerts(detail).length).toBe(1);
    // The Toolsets head's line and the detail's line.
    expect(alerts(host).length).toBeGreaterThanOrEqual(2);
    for (const line of alerts(host)) expect(line).not.toMatch(RAW);
  });
  it("Advanced keeps the exact words", async () => {
    localStorage.setItem("branch.level", "advanced");
    await open("Toolsets", FAILURES[1], "advanced");
    await flip(host.querySelector("[data-toolset=web]")!);
    expect(alerts(host).join(" ")).toContain("ECONNREFUSED");
  });
});
