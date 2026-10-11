// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { LibraryPlace } from "./index";
import { applyMemoryImport, BRING_IN_WRITE_REASON, readFound } from "./memory-import";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });

type Handler = (method: string, params: Record<string, unknown>) => unknown;
function engineOf(handler: Handler, scopes: string[] = ["operator.admin"]) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const value = handler(method, params);
    if (value instanceof Error) throw value;
    return value;
  });
  const engine: WindowEngine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes };
  return { engine, request };
}
async function flush() { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); }
async function mount(engine: WindowEngine) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<LibraryPlace engine={engine} level="advanced" facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} />); });
  await flush();
}
const button = (label: string, rootEl: ParentNode = host) => [...rootEl.querySelectorAll("button")].find(b => b.textContent === label);
async function click(label: string, rootEl: ParentNode = host) {
  const b = button(label, rootEl); expect(b, label).toBeTruthy();
  await act(async () => { b!.click(); });
  await flush();
}

const MEMORY = "# MEMORY.md\n\n- Sam prefers an aisle seat.\n";
const FP = "f".repeat(64);
const FOUND_PLAN = {
  agentId: "a",
  providers: [
    {
      providerId: "claude-code", label: "Claude Code", found: true, planFingerprint: FP,
      summary: { planned: 2, skipped: 0, conflicts: 1, errors: 0 },
      warnings: ["One note already exists"],
      items: [
        { id: "i1", status: "planned", target: "MEMORY.md", source: "~/.claude" },
        { id: "i2", status: "planned", target: "USER.md" },
        { id: "i3", status: "skipped" },
      ],
    },
    { providerId: "hermes", label: "Hermes Agent", found: false, message: "Not found here", items: [], summary: { planned: 0, skipped: 0, conflicts: 0, errors: 0 } },
  ],
};
const EMPTY_PLAN = {
  agentId: "a",
  providers: [
    { providerId: "claude-code", label: "Claude Code", found: false, items: [], summary: { planned: 0, skipped: 0, conflicts: 0, errors: 0 } },
    { providerId: "hermes", label: "Hermes Agent", found: false, items: [], summary: { planned: 0, skipped: 0, conflicts: 0, errors: 0 } },
  ],
};

function base(extra: Handler = () => undefined): Handler {
  let extraFact = false;
  return (method, params) => {
    const v = extra(method, params);
    if (v !== undefined) return v;
    if (method === "agents.list") return { defaultId: "a", mainKey: "agent:a:main", agents: [{ id: "a", identity: { name: "Birch" } }] };
    if (method === "agents.files.get") {
      const extraLine = extraFact ? "- Brought in from Claude Code.\n" : "";
      return params.name === "MEMORY.md"
        ? { file: { name: "MEMORY.md", content: MEMORY + extraLine, hash: extraFact ? "h-after" : "h-a", missing: false } }
        : { file: { name: "USER.md", missing: true } };
    }
    if (method === "doctor.memory.status") return { provider: "builtin", embedding: { ok: true, checked: true, checkedAtMs: Date.now() } };
    if (method === "config.get") return { config: { agents: { defaults: { bootstrapMaxChars: 12000 } } }, hash: "c" };
    if (method === "agents.workspace.list") return { entries: [] };
    if (method === "migrations.memory.plan") return FOUND_PLAN;
    if (method === "migrations.memory.apply") { extraFact = true; return { summary: { migrated: 2, skipped: 0, conflicts: 1, errors: 0 } }; }
    return {};
  };
}

describe("readFound", () => {
  it("keeps only found assistants with planned items, same as setup", () => {
    expect(readFound(FOUND_PLAN)).toEqual([{ providerId: "claude-code", label: "Claude Code", fingerprint: FP, items: ["i1", "i2"] }]);
    expect(readFound(EMPTY_PLAN)).toEqual([]);
  });
});

describe("Library › Memory › Bring in", () => {
  it("lists a found assistant, applies its plan fingerprint, and shows the summary", async () => {
    const { engine, request } = engineOf(base());
    await mount(engine);
    expect(host.textContent).toContain("Sam prefers an aisle seat.");
    expect(host.textContent).not.toContain("Brought in from Claude Code.");
    const bring = host.querySelector<HTMLButtonElement>('[data-testid="memory-bring-in"]');
    expect(bring?.disabled).toBe(false);
    await act(async () => { bring!.click(); });
    await flush();
    expect(request).toHaveBeenCalledWith("migrations.memory.plan", { agentId: "a" });
    const dlg = host.querySelector('[data-testid="bring-in-dialog"]')!;
    expect(dlg.textContent).toContain("Claude Code");
    expect(dlg.textContent).toContain("2 ready to bring in");
    expect(dlg.textContent).toContain("1 clash");
    expect(dlg.textContent).toContain("One note already exists");
    expect(dlg.textContent).toContain("Hermes Agent");
    expect(dlg.textContent).toContain("Not found here");
    expect(button("Bring it in", dlg)!.disabled).toBe(true);
    await act(async () => { [...dlg.querySelectorAll("button")].find(b => b.textContent?.includes("Claude Code"))!.click(); });
    await flush();
    expect(dlg.textContent).toContain("MEMORY.md");
    expect(button("Bring it in", dlg)!.disabled).toBe(false);
    await click("Bring it in", dlg);
    expect(request).toHaveBeenCalledWith("migrations.memory.apply", expect.objectContaining({
      agentId: "a", providerId: "claude-code", planFingerprint: FP, itemIds: ["i1", "i2"],
    }));
    const done = host.querySelector('[data-testid="bring-in-dialog"]')!;
    expect(done.textContent).toContain("2 brought in");
    expect(done.textContent).toContain("1 clashes");
    expect(host.textContent).toContain("Brought in from Claude Code.");
  });

  it("marks only the picked assistant with the shared selection style and a check", async () => {
    const plan = {
      ...FOUND_PLAN,
      providers: [
        ...FOUND_PLAN.providers,
        { ...FOUND_PLAN.providers[0], providerId: "other", label: "Other assistant" },
      ],
    };
    const { engine } = engineOf(base((m) => m === "migrations.memory.plan" ? plan : undefined));
    await mount(engine);
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="memory-bring-in"]')!.click(); });
    await flush();
    const dlg = host.querySelector('[data-testid="bring-in-dialog"]')!;
    const cards = [...dlg.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const [claude, unavailable, other] = cards;
    const expectPicked = (picked?: HTMLButtonElement) => {
      for (const card of cards) {
        expect(card.classList.contains("prov-st")).toBe(true);
        expect(card.getAttribute("aria-checked")).toBe(String(card === picked));
        expect(card.querySelector('[aria-hidden="true"]')?.textContent ?? "").toBe(card === picked ? "✓" : "");
      }
    };
    expect(cards).toHaveLength(3);
    expectPicked();
    expect(unavailable.disabled).toBe(true);
    await act(async () => { claude.click(); });
    expectPicked(claude);
    await act(async () => { unavailable.click(); });
    expectPicked(claude);
    await act(async () => { other.click(); });
    expectPicked(other);
    expect(button("Bring it in", dlg)!.disabled).toBe(false);
  });

  it("says nothing to apply when no assistant is found", async () => {
    const { engine, request } = engineOf(base((m) => m === "migrations.memory.plan" ? EMPTY_PLAN : undefined));
    await mount(engine);
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="memory-bring-in"]')!.click(); });
    await flush();
    const dlg = host.querySelector('[data-testid="bring-in-dialog"]')!;
    expect(dlg.textContent).toContain("Branch found no other assistant's memory on this computer.");
    expect(dlg.textContent).toContain("Claude Code");
    expect(dlg.textContent).toContain("Not found here");
    expect(button("Bring it in", dlg)!.disabled).toBe(true);
    expect(request).not.toHaveBeenCalledWith("migrations.memory.apply", expect.anything());
  });

  it("shows a plain-words apply error and leaves the list unchanged", async () => {
    const { engine, request } = engineOf(base((m) => m === "migrations.memory.apply" ? new Error("memory migration plan changed; refresh the plan before importing") : undefined));
    await mount(engine);
    expect(host.textContent).toContain("Sam prefers an aisle seat.");
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="memory-bring-in"]')!.click(); });
    await flush();
    const dlg = host.querySelector('[data-testid="bring-in-dialog"]')!;
    await act(async () => { [...dlg.querySelectorAll("button")].find(b => b.textContent?.includes("Claude Code"))!.click(); });
    await flush();
    await click("Bring it in", dlg);
    expect(request).toHaveBeenCalledWith("migrations.memory.apply", expect.objectContaining({ planFingerprint: FP }));
    expect(dlg.textContent).toContain("memory migration plan changed; refresh the plan before importing");
    expect(dlg.getAttribute("aria-label")).toBe("Move in from another assistant");
    expect(host.textContent).toContain("Sam prefers an aisle seat.");
    expect(host.textContent).not.toContain("Brought in from Claude Code.");
    expect(host.textContent).not.toContain("2 brought in");
  });

  it("disables Bring in for a non-owner with the write reason", async () => {
    const { engine, request } = engineOf(base(), ["operator.read"]);
    await mount(engine);
    const bring = button("Bring in")!;
    expect(bring.disabled).toBe(true);
    expect(bring.title).toBe(BRING_IN_WRITE_REASON);
    expect(host.querySelector('[data-testid="memory-bring-in"]')).toBeNull();
    expect(request).not.toHaveBeenCalledWith("migrations.memory.plan", expect.anything());
  });
});

describe("applyMemoryImport", () => {
  it("refuses an ok:false payload so a half import is never treated as done", async () => {
    const { engine } = engineOf(() => ({ ok: false, error: "Disk full" }));
    await expect(applyMemoryImport(engine, "a", { providerId: "claude-code", fingerprint: FP, items: ["i1"] })).rejects.toThrow("Disk full");
  });
});
