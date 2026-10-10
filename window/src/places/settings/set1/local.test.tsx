// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { LocalPage, LOCAL_ROWS, fitOf, foundRuntimes, hwOf } from "./local";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const GIB = 1024 ** 3;
const INFO = { machineName: "box", hostname: "box", platform: "win32", release: "10", arch: "x64", osLabel: "Windows", nodeVersion: "24", pid: 1, uptimeMs: 1, cpuCount: 16, cpuModel: "Test CPU 9000", memoryTotalBytes: 64 * GIB, memoryFreeBytes: GIB, diskAvailableBytes: 500 * GIB, port: 18789 };
const DETECT = {
  candidates: [{ kind: "provider-auto:ollama", brandId: "ollama", label: "Ollama", detail: "m at http://127.0.0.1:11434", modelRef: "ollama/m:7b", recommended: false }],
  unavailableCandidates: [], manualProviders: [], workspace: "~", setupComplete: true,
  prepareOptions: [{ id: "llama-cpp", brandId: "llama-cpp", label: "Managed local server", hint: "Pick a model for this computer and install it", actionLabel: "Set up model" }],
};
const MODELS = { models: [{ id: "m:7b", provider: "ollama", name: "Model Seven", local: true, supportsTools: true, input: ["text", "image"], contextWindow: 131072 }, { id: "gpt", provider: "openai", name: "Cloud" }] };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf(over: Record<string, unknown> = {}) {
  const replies: Record<string, unknown> = { "system.info": INFO, "branch.setup.detect": DETECT, "models.list": MODELS, "config.get": { hash: "h1", valid: true, config: {} }, "config.patch": { ok: true, hash: "h2", config: {} }, ...over };
  const request = vi.fn(async (method: string) => replies[method] ?? {});
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine, request };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine, level: 0 | 1 | 2 = 0) {
  await act(async () => root.render(<KitProvider level={level} report={report} scope={null}><LocalPage page="local" title="On this computer" level="regular" engine={engine} /></KitProvider>));
}
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(label));

describe("Settings › On this computer", () => {
  it("draws the hardware tiles from system.info, and greys the graphics card", async () => {
    await render(engineOf().engine);
    const tiles = [...host.querySelectorAll(".hw-c-k")].map((t) => t.textContent);
    expect(tiles).toEqual(["ProcessorTest CPU 9000", "Memory64 GB", "GraphicsNot read yet", "Free space500 GB", "RuntimeOllama"]);
    expect(host.querySelector(".hw-c-k.off-k")?.getAttribute("title")).toContain("graphics card");
  });

  it("shows the models on this computer and the engine's setup options; Set up runs the prepare wizard", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    const cards = [...host.querySelectorAll(".lm-k b")].map((b) => b.textContent);
    expect(cards).toEqual(["Model Seven", "Managed local server"]);
    expect(host.textContent).toContain("sees pictures");
    expect(host.textContent).toContain("131K-token context");
    await act(async () => button("Set up model")!.click());
    const start = request.mock.calls.find(([m]) => m === "branch.setup.prepare.start") as unknown as [string, Record<string, unknown>];
    expect(start[1]).toMatchObject({ authChoice: "llama-cpp" });
    expect(typeof start[1].sessionId).toBe("string");
  });

  it("marks found runtimes; Look for it runs detection again and says not found in place", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    const row = (name: string) => host.querySelector(`.prow[data-row="${name}"]`)!;
    expect(row("Ollama").querySelector(".pill.ok")?.textContent).toBe("Found");
    const before = request.mock.calls.filter(([m]) => m === "branch.setup.detect").length;
    await act(async () => [...row("vLLM").querySelectorAll("button")].find((b) => b.textContent === "Look for it")!.click());
    expect(request.mock.calls.filter(([m]) => m === "branch.setup.detect").length).toBe(before + 1);
    expect(row("vLLM").textContent).toContain("Not found on this computer. Branch can use it as soon as it runs.");
    expect(row("vLLM").textContent).toContain("Look again");
    expect([...row("Jan").querySelectorAll("button")][0].disabled).toBe(true);
  });

  it("gates Advanced: the share switch under Ollama and the endpoint switch save to the engine config", async () => {
    const { engine, request } = engineOf();
    await render(engine, 0);
    expect(host.textContent).not.toContain("Share with your other computers");
    expect(host.textContent).not.toContain("Running models here, more");
    await render(engine, 1);
    const share = host.querySelector<HTMLInputElement>('input[aria-label="Share with your other computers"]')!;
    expect(share.checked).toBe(true);
    await act(async () => share.click());
    const patch = request.mock.calls.find(([m]) => m === "config.patch") as unknown as [string, { raw: string }];
    expect(JSON.parse(patch[1].raw)).toEqual({ plugins: { entries: { ollama: { config: { nodeInference: { enabled: false } } } } } });
    expect(host.querySelector(".val-k")?.textContent).toBe("http://127.0.0.1:18789/v1");
  });

  it("says when nothing is here yet, and every runtime offers Look for it", async () => {
    await render(engineOf({ "branch.setup.detect": { candidates: [], manualProviders: [], workspace: "~", setupComplete: false }, "models.list": { models: [] } }).engine);
    expect(host.querySelector(".empty")?.textContent).toBe("Nothing to set up on this computer yet.");
    expect(host.querySelectorAll(".rt-k .pill.ok").length).toBe(0);
    expect([...host.querySelectorAll(".hw-c-k")].pop()?.textContent).toBe("RuntimeNone found");
  });

  it("works out the fit from the size picked (rule 1)", () => {
    expect(fitOf(5e9, { ramGb: 32, vramGb: 12, mac: false })).toBe("great");
    expect(fitOf(13e9, { ramGb: 32, vramGb: 12, mac: false })).toBe("ok");
    expect(fitOf(15e9, { ramGb: 32, vramGb: 12, mac: false })).toBe("no");
    expect(fitOf(20e9, { ramGb: 32, mac: true })).toBe("ok");
    expect(fitOf(15e9, { ramGb: 32, mac: false })).toBe("no");
    expect(hwOf({ platform: "darwin", arch: "arm64", memoryTotalBytes: 16 * GIB }).mac).toBe(true);
    expect(foundRuntimes(DETECT, []).has("ollama")).toBe(true);
    expect(LOCAL_ROWS.find((r) => r.title === "Let other apps use Branch’s models")?.lv).toBe(1);
  });
});
