// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { MemoryTab } from "./MemoryTerminal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });
function engineWith(request: ReturnType<typeof vi.fn>): WindowEngine {
  return { sessionKey: "agent:scout:main", agentId: "scout", request } as unknown as WindowEngine;
}
async function render(engine: WindowEngine) {
  if (!root) { container = document.createElement("div"); document.body.append(container); root = createRoot(container); }
  await act(async () => root!.render(<MemoryTab engine={engine} blocks={[{ kind: "user", key: "asked", text: "Remember my project" }]} name="Scout" />));
}

it("retries a failed memory search with the same conversation query and agent", async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error("Memory unavailable")).mockResolvedValueOnce({ results: [{ path: "project.md", snippet: "Actual project memory", startLine: 7 }] });
  await render(engineWith(request));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Memory unavailable");
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(container.textContent).toContain("Actual project memory");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(request).toHaveBeenCalledWith("memory.search", { query: "Remember my project", maxResults: 8, agentId: "scout" });
});

it("hides memory from the previous engine while the replacement engine is loading", async () => {
  await render(engineWith(vi.fn().mockResolvedValue({ results: [{ path: "old.md", snippet: "Previous gateway memory" }] })));
  expect(container.textContent).toContain("Previous gateway memory");
  let finish!: (value: unknown) => void;
  await render(engineWith(vi.fn(() => new Promise((resolve) => { finish = resolve; }))));
  expect(container.textContent).not.toContain("Previous gateway memory");
  expect(container.textContent).toContain("Looking through");
  await act(async () => finish({ results: [] }));
  expect(container.textContent).toContain("doesn't remember anything");
});
