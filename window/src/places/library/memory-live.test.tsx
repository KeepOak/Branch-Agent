// @vitest-environment jsdom
// Library › Memory reloads when the engine says a Trunk's files or the memory index changed (agents.changed /
// memory.changed), so a fact a Trunk or the owner just saved shows without a reload.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { LibraryPlace } from "./index";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });

const TRUNKS = { defaultId: "a", mainKey: "agent:a:main", agents: [{ id: "a", identity: { name: "Birch" } }] };

describe("Library › Memory live-updates", () => {
  it.each(["agents.changed", "memory.changed"])("re-reads the memory files and status on %s", async (event) => {
    let memory = "# MEMORY.md\n\n- Sam prefers an aisle seat.\n";
    const listeners = new Set<(e: { event: string; payload?: unknown }) => void>();
    const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
      if (method === "agents.list") return TRUNKS;
      if (method === "agents.files.get") return params.name === "MEMORY.md" ? { file: { name: "MEMORY.md", content: memory, hash: memory.length.toString() } } : { file: { name: "USER.md", missing: true } };
      if (method === "doctor.memory.status") return { provider: "builtin" };
      if (method === "config.get") return { config: {}, hash: "c" };
      if (method === "agents.workspace.list") return { entries: [] };
      return {};
    });
    const engine: WindowEngine = { request: request as unknown as WindowEngine["request"], onEvent: (l) => { listeners.add(l); return () => listeners.delete(l); }, sessionKey: null, scopes: ["operator.admin"] };
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => { root!.render(<LibraryPlace engine={engine} level="regular" facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} />); });
    const memoryTab = [...host.querySelectorAll("button")].find((b) => b.textContent === "Memory");
    if (memoryTab) await act(async () => memoryTab.click());
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await vi.waitFor(() => expect(host.textContent).toContain("Sam prefers an aisle seat."));
    const statusReads = request.mock.calls.filter(([m]) => m === "doctor.memory.status").length;

    memory = "# MEMORY.md\n\n- Sam prefers an aisle seat.\n- Invoices go to Finance.\n";
    await act(async () => { for (const l of listeners) l({ event, payload: { method: "agents.files.set" } }); });
    await vi.waitFor(() => expect(host.textContent).toContain("Invoices go to Finance."));
    expect(request.mock.calls.filter(([m]) => m === "doctor.memory.status").length).toBeGreaterThan(statusReads);
  });
});
