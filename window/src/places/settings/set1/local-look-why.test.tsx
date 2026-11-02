// @vitest-environment jsdom
// Private #1093 / Ease #5: On this computer › LocalAI / Jan "Look for it" was greyed with title={shownWhy(...)}
// only. A visible why-k line + aria-describedby is required (tooltip alone does not count; #1727 crawl).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { LocalPage } from "./local";
import { NO_PROBE } from "./local-runtimes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const GIB = 1024 ** 3;
const INFO = {
  machineName: "box", hostname: "box", platform: "win32", release: "10", arch: "x64", osLabel: "Windows",
  nodeVersion: "24", pid: 1, uptimeMs: 1, cpuCount: 16, cpuModel: "Test CPU 9000",
  memoryTotalBytes: 64 * GIB, memoryFreeBytes: GIB, diskAvailableBytes: 500 * GIB, port: 18789,
};
const DETECT = {
  candidates: [{ kind: "provider-auto:ollama", brandId: "ollama", label: "Ollama", detail: "m at http://127.0.0.1:11434", modelRef: "ollama/m:7b", recommended: false }],
  unavailableCandidates: [], manualProviders: [], workspace: "~", setupComplete: true,
  prepareOptions: [],
};
const MODELS = { models: [{ id: "m:7b", provider: "ollama", name: "Model Seven", local: true }] };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
});

const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };

async function render(level: 0 | 1 | 2 = 0) {
  const request = vi.fn(async (method: string) => {
    if (method === "system.info") return INFO;
    if (method === "branch.setup.detect") return DETECT;
    if (method === "models.list") return MODELS;
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    return {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
  await act(async () =>
    root.render(
      <KitProvider level={level} report={report} scope={null}>
        <LocalPage page="local" title="On this computer" level="regular" engine={engine} />
      </KitProvider>,
    ),
  );
  await act(async () => {
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

const row = (name: string) => host.querySelector<HTMLElement>(`.prow[data-row="${name}"]`)!;

describe("Settings › On this computer LocalAI/Jan Look for it why (#1093)", () => {
  it("at Regular, Jan and LocalAI grey Look for it names NO_PROBE with aria-describedby", async () => {
    await render(0);
    for (const name of ["Jan", "LocalAI"] as const) {
      const r = row(name);
      expect(r).not.toBeNull();
      const btn = [...r.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Look for it");
      expect(btn).toBeTruthy();
      expect(btn!.disabled).toBe(true);
      const whyId = btn!.getAttribute("aria-describedby");
      expect(whyId).toBeTruthy();
      const whyEl = document.getElementById(whyId!);
      expect(whyEl).not.toBeNull();
      expect(whyEl!.classList.contains("why-k")).toBe(true);
      expect(whyEl!.textContent).toBe(NO_PROBE);
      expect(r.textContent).toContain(NO_PROBE);
      // Product blurb is replaced by the why while Look for it is off.
      expect(r.textContent).not.toContain("Any non-empty key works");
    }
    // Probeable neighbour still offers a live Look for it.
    const vllm = row("vLLM");
    const live = [...vllm.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Look for it");
    expect(live).toBeTruthy();
    expect(live!.disabled).toBe(false);
    expect(live!.getAttribute("aria-describedby")).toBeNull();
  });

  it("shows the same visible why at Advanced and Technical", async () => {
    for (const level of [1, 2] as const) {
      await render(level);
      const btn = [...row("Jan").querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Look for it")!;
      expect(btn.disabled).toBe(true);
      expect(document.getElementById(btn.getAttribute("aria-describedby")!)!.textContent).toBe(NO_PROBE);
    }
  });
});
