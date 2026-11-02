// @vitest-environment jsdom
// #1101 (Hermes A-140, A-138): Customize › Toolsets says which toolsets are on, counts them, and marks a toolset that is on
// but has a tool whose service or sign-in is missing, from the engine's own state, with a Set up button to that page.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { CustomizePlace } from "./index";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tool = (id: string, label: string) => ({ id, label, source: "core", defaultProfiles: ["full"] });
const CATALOG = { groups: [
  { id: "fs", label: "Files", source: "core", tools: [tool("apply_patch", "apply_patch")] },
  { id: "web", label: "Web", source: "core", tools: [tool("web_search", "Web search"), tool("web_fetch", "Fetch a page")] },
  { id: "media", label: "Media", source: "core", tools: [tool("tts", "Speak aloud"), tool("image_generate", "Make a picture")] },
  { id: "sessions", label: "Sessions", source: "core", tools: [tool("github_publish", "Publish a pull request")] },
] };
const NO_SEARCH = { enabled: true, agentId: "main", provider: null, model: { provider: "x", id: "y", runtime: "z" }, route: { kind: "unavailable", label: "No search", testable: false }, providers: [] };
const NATIVE_SEARCH = { ...NO_SEARCH, route: { kind: "native", label: "The model's own search", testable: true } };
const NO_VOICE = { enabled: true, providerStates: [{ id: "openai", label: "OpenAI", configured: false }] };
const VOICE = { enabled: true, providerStates: [{ id: "openai", label: "OpenAI", configured: true }] };
const GITHUB_OK = { agentId: "main", effective: { credentialState: "available" } };
const GITHUB_NONE = { agentId: "main", effective: { credentialState: "unavailable" } };
const config = (deny: string[]) => ({ hash: "h1", sourceConfig: { tools: { deny } }, runtimeConfig: { tools: { deny } } });

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });

async function open(fx: Record<string, unknown>, level: Level = "regular") {
  const table: Record<string, unknown> = {
    "agents.list": { defaultId: "main", mainKey: "main", agents: [{ id: "main", name: "Sapling" }] },
    "config.get": config(["group:fs"]), "tools.catalog": CATALOG, "skills.status": { skills: [] }, "plugins.list": { plugins: [] },
    "acpx.agents.list": { agents: [] }, "skills.library.list": { entries: [] },
    "webSearch.status": NO_SEARCH, "tts.status": NO_VOICE, "tools.github.status": GITHUB_OK, ...fx,
  };
  const request = vi.fn((method: string) => Promise.resolve(table[method] ?? { ok: true }));
  const openSettings = vi.fn();
  const engine = { request, onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<CustomizePlace engine={engine} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} openSettings={openSettings} level={level} />); });
  await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "customize", tab: "Toolsets" } })); });
  for (let i = 0; i < 4; i++) await act(async () => { await Promise.resolve(); });
  return { request, openSettings };
}
const row = (id: string) => host.querySelector(`[data-toolset="${id}"]`)!;
const sw = (id: string) => row(id).querySelector("[role=switch]")!;

describe("#1101 Toolsets: on/off, counts and Needs setup from real state (A-140)", () => {
  it("shows each toolset on or off, counts them, and badges the ones on without their service", async () => {
    const { openSettings } = await open({});
    expect(host.querySelector("[data-kind-list=Toolsets] .cz-count")?.textContent).toBe("3 on · 2 need setup");
    expect(sw("fs").getAttribute("aria-checked")).toBe("false");
    expect(sw("web").getAttribute("aria-checked")).toBe("true");
    expect(row("web").textContent).toContain("Needs setup");
    expect(row("media").textContent).toContain("Needs setup");
    expect(row("sessions").textContent).not.toContain("Needs setup");
    expect(row("fs").textContent).not.toContain("Needs setup");
    // Plain names at Regular, not tool ids (an id with no label of its own is put in words), and "1 tool".
    expect(row("web").querySelector("small")?.textContent).toBe("2 tools: Web search, Fetch a page");
    expect(row("fs").querySelector("small")?.textContent).toBe("1 tool: Apply patch");
    await act(async () => { (row("web").querySelector("[aria-label='Set up Web']") as HTMLElement).click(); });
    expect(openSettings).toHaveBeenLastCalledWith("customize");
    await act(async () => { (row("media").querySelector("[aria-label='Set up Media']") as HTMLElement).click(); });
    expect(openSettings).toHaveBeenLastCalledWith("voice");
  });

  it("follows the engine: a search route, a configured voice and a GitHub sign-in clear it; a lost sign-in adds it", async () => {
    await open({ "webSearch.status": NATIVE_SEARCH, "tts.status": VOICE, "tools.github.status": GITHUB_NONE });
    expect(row("web").textContent).not.toContain("Needs setup");
    expect(row("media").textContent).not.toContain("Needs setup");
    expect(row("sessions").textContent).toContain("Needs setup");
    expect(host.querySelector("[data-kind-list=Toolsets] .cz-count")?.textContent).toBe("3 on · 1 needs setup");
  });

  it("draws a switch as a switch: the place's pill button style leaves role=switch alone, so on and off show", () => {
    const placesCss = readFileSync("src/places/library/places.css", "utf8");
    const rule = placesCss.split("}").find(r => r.includes(".kp button:not(") && r.includes("height:32px")) ?? "";
    expect(rule).toContain("[role=switch]");
    expect(placesCss.split("}").find(r => r.includes(".kp button:hover")) ?? "").toContain("[role=switch]");
  });

  it("never badges a toolset that is off, and shows tool ids only at Technical", async () => {
    await open({ "config.get": config(["group:web", "group:fs"]) }, "technical");
    expect(row("web").textContent).not.toContain("Needs setup");
    expect(row("web").querySelector("small")?.textContent).toBe("2 tools: web_search, web_fetch");
    expect(host.querySelector("[data-kind-list=Toolsets] .cz-count")?.textContent).toBe("2 on · 1 needs setup");
  });
});
