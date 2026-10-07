// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { MemoryTab } from "./MemoryTerminal";
import * as notify from "../../shell/notify";

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

async function click(label: string) {
  await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!.click());
}

it("forgets a memory by calling agents.files.set with the fact removed and the right expectedHash", async () => {
  const memoryContent = "- First memory\n  Detail line\n- Second memory\n  Another detail\n- Third memory";
  const request = vi.fn()
    .mockResolvedValueOnce({ results: [{ path: "MEMORY.md", snippet: "Second memory", startLine: 2, endLine: 4 }] })
    .mockResolvedValueOnce({ file: { content: memoryContent, hash: "abc123" } })
    .mockResolvedValueOnce({});
  
  const notifySpy = vi.spyOn(notify, "notify");
  await render(engineWith(request));
  
  expect(container.textContent).toContain("Second memory");
  await click("Forget");
  
  expect(request).toHaveBeenCalledWith("agents.files.get", { agentId: "scout", name: "MEMORY.md" });
  expect(request).toHaveBeenCalledWith("agents.files.set", { 
    agentId: "scout", 
    name: "MEMORY.md", 
    content: "- First memory\n  Detail line\n- Third memory", 
    expectedHash: "abc123" 
  });
  expect(notifySpy).toHaveBeenCalledWith("Forgotten. It won't use this again.", expect.objectContaining({ action: expect.any(Object) }));
  expect(container.textContent).not.toContain("Second memory");
});

it("shows an error and writes nothing when the file hash conflicts", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce({ results: [{ path: "MEMORY.md", snippet: "Old memory", startLine: 0, endLine: 1 }] })
    .mockResolvedValueOnce({ file: { content: "- Old memory", hash: "abc123" } })
    .mockRejectedValueOnce(new Error("Hash conflict: the file was changed"));
  
  const notifySpy = vi.spyOn(notify, "notify");
  await render(engineWith(request));
  
  await click("Forget");
  
  expect(notifySpy).toHaveBeenCalledWith("Hash conflict: the file was changed", { tone: "bad" });
  expect(container.textContent).toContain("Old memory");
});

it("keeps the Forget button disabled for memories that are not from MEMORY.md", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce({ results: [{ path: "sessions/2026-10-07.md", snippet: "Session memory", startLine: 5, endLine: 6 }] });
  
  await render(engineWith(request));
  
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Forget");
  expect(button?.disabled).toBe(true);
  expect(button?.title).toContain("This memory isn't from MEMORY.md");
});

it("restores the forgotten memory when Undo is clicked", async () => {
  const memoryContent = "- Only memory";
  const request = vi.fn()
    .mockResolvedValueOnce({ results: [{ path: "MEMORY.md", snippet: "Only memory", startLine: 0, endLine: 1 }] })
    .mockResolvedValueOnce({ file: { content: memoryContent, hash: "abc123" } })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ results: [{ path: "MEMORY.md", snippet: "Only memory", startLine: 0, endLine: 1 }] });
  
  const notifySpy = vi.spyOn(notify, "notify");
  await render(engineWith(request));
  
  expect(container.textContent).toContain("Only memory");
  await click("Forget");
  expect(container.textContent).not.toContain("Only memory");
  
  const undoAction = notifySpy.mock.calls[0]?.[1]?.action;
  expect(undoAction).toBeDefined();
  
  await act(async () => undoAction?.run());
  
  expect(request).toHaveBeenCalledWith("agents.files.set", { 
    agentId: "scout", 
    name: "MEMORY.md", 
    content: memoryContent, 
    expectedHash: undefined 
  });
});

it("shows an error when the engine does not return a file hash", async () => {
  const request = vi.fn()
    .mockResolvedValueOnce({ results: [{ path: "MEMORY.md", snippet: "Memory", startLine: 0, endLine: 1 }] })
    .mockResolvedValueOnce({ file: { content: "- Memory" } });
  
  const notifySpy = vi.spyOn(notify, "notify");
  await render(engineWith(request));
  
  await click("Forget");
  
  expect(notifySpy).toHaveBeenCalledWith("The engine did not give this file's revision, so it can't be changed safely.", { tone: "bad" });
  expect(container.textContent).toContain("Memory");
});
