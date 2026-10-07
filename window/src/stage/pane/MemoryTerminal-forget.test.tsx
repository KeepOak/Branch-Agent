// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { factForHit, parseFacts, withoutFact } from "../../places/library/memory-data";
import * as notify from "../../shell/notify";
import { MemoryTab } from "./MemoryTerminal";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let container: HTMLElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

const MEMORY = "# MEMORY.md\n\n- First memory\n  Detail line\n- Second memory\n  Another detail\n- Third memory\n";
const HASH = "abc123";

function engineWith(request: ReturnType<typeof vi.fn>): WindowEngine {
  return { sessionKey: "agent:scout:main", agentId: "scout", request } as unknown as WindowEngine;
}

function files(handler?: (method: string, params: Record<string, unknown>) => unknown) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const extra = handler?.(method, params);
    if (extra !== undefined) return extra;
    if (method === "memory.search") return { results: [{ path: "MEMORY.md", snippet: "Second memory", startLine: 5 }] };
    if (method === "agents.files.get") return { file: { name: "MEMORY.md", content: MEMORY, hash: HASH } };
    if (method === "agents.files.set") return { ok: true, file: { name: "MEMORY.md", hash: "after", content: "written" } };
    return {};
  });
  return { engine: engineWith(request), request };
}

async function render(engine: WindowEngine) {
  if (!root) { container = document.createElement("div"); document.body.append(container); root = createRoot(container); }
  await act(async () => root!.render(<MemoryTab engine={engine} blocks={[{ kind: "user", key: "asked", text: "Remember my project" }]} name="Scout" />));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

it("forgets a memory by calling agents.files.set with the fact removed and the right expectedHash", async () => {
  const { engine, request } = files();
  const notifySpy = vi.spyOn(notify, "notify");
  await render(engine);
  expect(container.textContent).toContain("Second memory");
  await click("Forget");
  const second = parseFacts(MEMORY, "scout", "")[1]!;
  expect(request).toHaveBeenCalledWith("agents.files.get", { agentId: "scout", name: "MEMORY.md" });
  expect(request).toHaveBeenCalledWith("agents.files.set", {
    agentId: "scout",
    name: "MEMORY.md",
    content: withoutFact(MEMORY, second),
    expectedHash: HASH,
  });
  expect(notifySpy).toHaveBeenCalledWith("Forgotten. It won’t use this again.", expect.objectContaining({ action: expect.any(Object) }));
  expect(container.textContent).not.toContain("Second memory");
});

it("shows an error and writes nothing when the file hash conflicts", async () => {
  const { engine, request } = files((method) => {
    if (method === "agents.files.set") throw new Error('agent file "MEMORY.md" changed since it was read');
  });
  const notifySpy = vi.spyOn(notify, "notify");
  await render(engine);
  await click("Forget");
  expect(notifySpy).toHaveBeenCalledWith('agent file "MEMORY.md" changed since it was read', { tone: "bad" });
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('agent file "MEMORY.md" changed since it was read');
  expect(container.textContent).toContain("Second memory");
  expect(request.mock.calls.filter(([method]) => method === "agents.files.set")).toHaveLength(1);
});

it("keeps the Forget button disabled for memories that are not from MEMORY.md", async () => {
  const { engine } = files((method) => {
    if (method === "memory.search") return { results: [{ path: "sessions/2026-10-07.md", snippet: "Session memory", startLine: 5 }] };
  });
  await render(engine);
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Forget");
  expect(button?.disabled).toBe(true);
  expect(button?.title).toContain("This isn’t a MEMORY.md fact");
});

it("maps a session-search hit onto the matching MEMORY.md fact so Forget can run", async () => {
  const { engine, request } = files((method) => {
    if (method === "memory.search") return { results: [{ path: "sessions/2026-10-07.md", snippet: "Second memory", startLine: 12 }] };
  });
  await render(engine);
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Forget");
  expect(button?.disabled).toBe(false);
  await click("Forget");
  expect(request).toHaveBeenCalledWith("agents.files.set", expect.objectContaining({
    name: "MEMORY.md",
    content: withoutFact(MEMORY, parseFacts(MEMORY, "scout", "")[1]!),
    expectedHash: HASH,
  }));
});

it("restores the forgotten memory when Undo is clicked", async () => {
  const { engine, request } = files();
  const notifySpy = vi.spyOn(notify, "notify");
  await render(engine);
  expect(container.textContent).toContain("Second memory");
  await click("Forget");
  expect(container.textContent).not.toContain("Second memory");
  const undo = notifySpy.mock.calls[0]?.[1]?.action;
  expect(undo).toBeDefined();
  await act(async () => undo?.run());
  await act(async () => { await Promise.resolve(); });
  expect(request).toHaveBeenCalledWith("agents.files.set", {
    agentId: "scout",
    name: "MEMORY.md",
    content: MEMORY,
    expectedHash: "after",
  });
});

it("shows an error when the engine does not return a file hash", async () => {
  const { engine, request } = files((method) => {
    if (method === "agents.files.get") return { file: { name: "MEMORY.md", content: MEMORY } };
  });
  const notifySpy = vi.spyOn(notify, "notify");
  await render(engine);
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Forget");
  expect(button?.disabled).toBe(false);
  await click("Forget");
  expect(notifySpy).toHaveBeenCalledWith("The engine did not give this file’s revision, so it can’t be changed safely.", { tone: "bad" });
  expect(container.textContent).toContain("Second memory");
  expect(request.mock.calls.some(([method]) => method === "agents.files.set")).toBe(false);
});

it("places a MEMORY.md search line onto the parsed fact Library forgets", () => {
  const facts = parseFacts(MEMORY, "scout", "");
  expect(factForHit(facts, { path: "MEMORY.md", snippet: "Second memory", startLine: 5 })?.text).toBe("Second memory");
  expect(factForHit(facts, { path: "memory/2026-10-07.md", snippet: "daily note", startLine: 1 })).toBeNull();
  expect(factForHit(facts, { path: "sessions/x.md", snippet: "First memory", startLine: 9 })?.text).toBe("First memory");
});
