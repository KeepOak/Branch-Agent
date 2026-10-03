// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { InstructionsPage } from "./instructions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const H1 = "a".repeat(64), H2 = "b".repeat(64), H3 = "c".repeat(64);
let STORE: Record<string, { content: string; hash: string }> = {};
const fresh = () => ({ "main/SOUL.md": { content: "# Soul\n\nPlain words.\n", hash: H1 }, "main/AGENTS.md": { content: "# Rules\n- Ask first\n", hash: H1 } });

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { STORE = fresh(); host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

class Refused extends Error { details: unknown; constructor(message: string, details: unknown) { super(message); this.details = details; } }

function engineOf(over: Record<string, (p: Record<string, unknown>) => unknown> = {}) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (method in over) return over[method](params);
    if (method === "agents.list") return { defaultId: "main", agents: [{ id: "main", identity: { name: "Sapling" } }, { id: "two", identity: { name: "Second" } }] };
    if (method === "agents.files.list") return { agentId: params.agentId, workspace: "/w", files: [{ name: "AGENTS.md", path: "/w/AGENTS.md", missing: false }, { name: "BOOTSTRAP.md", path: "/w/BOOTSTRAP.md", missing: true }] };
    if (method === "agents.files.get") {
      const t = STORE[`${params.agentId}/${params.name}`];
      return { file: t === undefined ? { name: params.name, path: `/w/${params.name}`, missing: true } : { name: params.name, path: `/w/${params.name}`, missing: false, hash: t.hash, content: t.content } };
    }
    if (method === "agents.files.set") return { ok: true, file: { name: params.name, missing: false, hash: H2, content: params.content } };
    if (method === "users.personalFile.get") throw new Refused("Personal instructions are only available on multi-user Gateways.", undefined);
    if (method === "skills.library.list") return { entries: [{ skillId: "1", slug: "brief", description: "Write a one-page brief.", removed: false, enabled: true }] };
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine, request };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine, level: 0 | 1 | 2 = 0) {
  await act(async () => root.render(<KitProvider level={level} report={report} scope={null}><InstructionsPage page="instructions" title="Instructions & personality" level="regular" engine={engine} /></KitProvider>));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const row = (what: string) => host.querySelector<HTMLElement>(`.if-row[data-row^="${what}"]`)!;
const button = (scope: ParentNode, label: string) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;
async function type(el: HTMLTextAreaElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}

describe("Settings › Instructions & personality", () => {
  it("draws Every Trunk and each Trunk, and the files with their line counts from the engine", async () => {
    const { engine } = engineOf();
    await render(engine);
    expect([...host.querySelectorAll(".if-chips .chip6")].map((b) => b.textContent)).toEqual(["Every Trunk", "Second"]);
    expect(row("Who your assistant is").querySelector("small")!.textContent).toBe("3 lines");
    expect(row("Its name").querySelector("small")!.textContent).toBe("Empty");
    expect(button(row("Who your assistant is"), "Edit")).toBeTruthy();
    expect(button(row("Its name"), "Write")).toBeTruthy();
    expect(row("Notes on the tools").classList.contains("off-k")).toBe(true);
    expect(button(row("Notes on the tools"), "Write").disabled).toBe(true);
    expect(row("Who your assistant is").querySelector<HTMLInputElement>('input[aria-label="Read SOUL.md"]')!.checked).toBe(true);
  });

  it("saves an edited file with the hash it read, and a new one as expected missing", async () => {
    const { engine, request } = engineOf();
    await render(engine);
    await act(async () => button(row("Who your assistant is"), "Edit").click());
    const dlg = document.querySelector<HTMLElement>('[data-testid="instruction-file"]')!;
    expect(dlg.getAttribute("aria-label")).toBe("SOUL.md · every Trunk");
    await type(dlg.querySelector("textarea")!, "# Soul\n\nShort answers.\n");
    expect(dlg.getAttribute("aria-label")).toBe("SOUL.md · every Trunk · unsaved");
    await act(async () => button(dlg, "Save").click());
    expect(request).toHaveBeenCalledWith("agents.files.set", { agentId: "main", name: "SOUL.md", content: "# Soul\n\nShort answers.\n", expectedHash: H1 });
    await act(async () => button(row("Its name"), "Write").click());
    await type(document.querySelector<HTMLTextAreaElement>('[data-testid="instruction-file"] textarea')!, "# Me\n");
    await act(async () => document.querySelector('[data-testid="instruction-file"] .if-ed')!.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true })));
    expect(request).toHaveBeenCalledWith("agents.files.set", { agentId: "main", name: "IDENTITY.md", content: "# Me\n", expectedMissing: true });
  });

  async function staleSave(change: () => void) {
    let refused = false;
    const { engine, request } = engineOf({
      "agents.files.set": (p) => { if (!refused) { refused = true; throw new Refused('agent file "SOUL.md" changed since it was read', { type: "agent_file_conflict", name: "SOUL.md" }); } return { ok: true, file: { name: p.name, hash: H2 } }; },
    });
    await render(engine);
    await act(async () => button(row("Who your assistant is"), "Edit").click());
    const dlg = document.querySelector<HTMLElement>('[data-testid="instruction-file"]')!;
    await type(dlg.querySelector("textarea")!, "Mine\n");
    await act(async () => button(dlg, "Save").click());
    expect(dlg.querySelector(".if-conflict")!.textContent).toContain("Changed on this computer");
    expect(button(dlg, "Save").disabled).toBe(true);
    change();
    const before = request.mock.calls.length;
    await act(async () => button(dlg, "Overwrite").click());
    const after = request.mock.calls.slice(before, before + 2).map(([m]) => m);
    expect(after).toEqual(["agents.files.get", "agents.files.set"]);
    return request.mock.calls.filter(([m]) => m === "agents.files.set")[1][1];
  }

  it("a stale save shows Changed on this computer; Overwrite reads the file again and saves with its new hash", async () => {
    const second = await staleSave(() => { STORE["main/SOUL.md"] = { content: "Theirs\n", hash: H3 }; });
    expect(second).toEqual({ agentId: "main", name: "SOUL.md", content: "Mine\n", expectedHash: H3 });
  });

  it("Overwrite after the file was deleted elsewhere makes it again (expected missing, no hash)", async () => {
    const second = await staleSave(() => { delete STORE["main/SOUL.md"]; });
    expect(second).toEqual({ agentId: "main", name: "SOUL.md", content: "Mine\n", expectedMissing: true });
  });

  it("Escape asks before dropping changes", async () => {
    const { engine } = engineOf();
    await render(engine);
    await act(async () => button(row("House rules"), "Edit").click());
    const dlg = document.querySelector<HTMLElement>('[data-testid="instruction-file"]')!;
    await type(dlg.querySelector("textarea")!, "changed");
    await act(async () => dlg.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(dlg.querySelector(".if-ask")!.textContent).toBe("Discard your changes?");
    await act(async () => button(dlg, "Discard").click());
    expect(document.querySelector('[data-testid="instruction-file"]')).toBeNull();
  });

  it("gates rows by level: Add a file… and the message rows at Advanced, paths at Technical", async () => {
    const { engine } = engineOf();
    await render(engine, 0);
    expect(host.textContent).not.toContain("What goes with every message");
    expect(host.textContent).not.toContain("Add a file…");
    expect(host.textContent).toContain("Project instructions");
    await render(engine, 1);
    expect(host.textContent).toContain("What goes with every message");
    expect(host.textContent).toContain("Add a file…");
    expect(host.textContent).toContain("/brief");
    expect(host.querySelector(".if-path")).toBeNull();
    await render(engine, 2);
    expect(row("Who your assistant is").querySelector(".if-path")!.textContent).toBe("/w/SOUL.md");
  });

  it("Just about you stays away on a one-person Branch, and saves the person's own USER.md otherwise", async () => {
    const one = engineOf();
    await render(one.engine);
    expect(host.textContent).not.toContain("Just about you");
    const many = engineOf({ "users.personalFile.get": () => ({ agentId: "main", profileId: "p1", content: "", hash: null, missing: true }) });
    await render(many.engine);
    await act(async () => button(row("Just about you"), "Write").click());
    const dlg = document.querySelector<HTMLElement>('[data-testid="just-about-you"]')!;
    expect(dlg.textContent).toContain("0 / 4,000 characters");
    await type(dlg.querySelector("textarea")!, "x".repeat(4001));
    expect(button(dlg, "Save").disabled).toBe(true);
    await type(dlg.querySelector("textarea")!, "Call me T.");
    await act(async () => button(dlg, "Save").click());
    expect(many.request).toHaveBeenCalledWith("users.personalFile.set", { agentId: "main", content: "Call me T.", expectedHash: null });
  });
});
