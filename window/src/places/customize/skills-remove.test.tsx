// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { CustomizePlace } from "./index";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG = {
  hash: "h1",
  sourceConfig: { agents: { entries: { main: {} } } },
  runtimeConfig: {},
};
const LIBRARY_SKILL = {
  name: "file-receipts",
  skillKey: "file-receipts",
  description: "File receipts from a folder",
  bundled: false,
  source: "clawhub",
  clawhub: true,
  disabled: false,
  eligible: true,
  missing: {},
};
const LIBRARY_ENTRY = {
  skillId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  slug: "file-receipts",
  name: "file-receipts",
  revision: "a".repeat(64),
};
const BUILTIN_SKILL = {
  name: "web",
  skillKey: "web",
  description: "Search the web",
  bundled: true,
  disabled: false,
  eligible: true,
  missing: {},
};
const WORKSPACE_SKILL = {
  name: "local-notes",
  skillKey: "local-notes",
  description: "Notes in this Trunk’s folder",
  bundled: false,
  source: "workspace",
  disabled: false,
  eligible: true,
  missing: {},
};
const BASE: Record<string, unknown> = {
  "agents.list": { defaultId: "main", mainKey: "main", agents: [{ id: "main", name: "Sapling" }] },
  "config.get": CONFIG,
  "tools.effective": { groups: [] },
  "skills.status": { skills: [LIBRARY_SKILL] },
  "skills.gardener.status": { lastSuccessAtMs: null, counts: { active: 0, stale: 0, archived: 0 }, skills: [] },
  "skills.proposals.list": { proposals: [] },
  "skills.library.list": { entries: [LIBRARY_ENTRY] },
  "skills.library.read": { revisions: [] },
  "plugins.list": { plugins: [] },
  "acpx.agents.list": { agents: [] },
  "tools.catalog": { groups: [] },
  "exec.approvals.get": { hash: "e1", file: { version: 1, agents: {} }, resolvedDefaults: { ask: "on-miss" } },
};

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });

async function open(fx: Record<string, unknown> = {}, level: "regular" | "advanced" = "advanced") {
  const table = { ...BASE, ...fx };
  const request = vi.fn((method: string) => {
    const v = table[method];
    if (v instanceof Error) return Promise.reject(v);
    return Promise.resolve(typeof v === "function" ? (v as () => unknown)() : v ?? { ok: true });
  });
  const engine: WindowEngine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", scopes: ["operator.admin"] };
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<CustomizePlace engine={engine} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} level={level} />); });
  await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "customize", tab: "Skills" } })); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return request;
}
const detail = () => host.querySelector('[data-testid="skill-detail"]')!;
const button = (text: string, scope: ParentNode = host) => [...scope.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await act(async () => { await Promise.resolve(); }); };

describe("Skills Remove button", () => {
  it("calls skills.library.mutate with remove action after confirmation for library skill", async () => {
    const request = await open();
    const remove = button("Remove", detail());
    expect(remove).toBeTruthy();
    expect(remove!.disabled).toBe(false);
    await click(remove);
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute("aria-label")).toBe("Remove file-receipts?");
    expect(dialog?.textContent).toContain("This removes file-receipts from your library. You can install it again later.");
    await click(button("Remove", dialog!));
    expect(request).toHaveBeenCalledWith("skills.library.mutate", {
      skillId: LIBRARY_ENTRY.skillId,
      expectedRevision: LIBRARY_ENTRY.revision,
      action: "remove",
    });
    expect(request.mock.calls.filter(([method]) => method === "skills.status").length).toBeGreaterThan(1);
  });

  it("shows Remove disabled with reason for built-in skill", async () => {
    await open({
      "skills.status": { skills: [BUILTIN_SKILL] },
      "skills.library.list": { entries: [] },
    });
    const remove = button("Remove", detail());
    expect(remove).toBeTruthy();
    expect(remove!.disabled).toBe(true);
    expect(remove!.getAttribute("title")).toBe("Built-in skills can't be removed; turn it off instead.");
    expect(remove!.getAttribute("data-reason")).toBe("Built-in skills can't be removed; turn it off instead.");
  });

  it("shows Remove disabled with reason for a workspace skill", async () => {
    await open({
      "skills.status": { skills: [WORKSPACE_SKILL] },
      "skills.library.list": { entries: [] },
    });
    const remove = button("Remove", detail());
    expect(remove).toBeTruthy();
    expect(remove!.disabled).toBe(true);
    expect(remove!.getAttribute("title")).toBe("Workspace skills can't be removed; delete the file.");
  });

  it("shows engine error when remove fails", async () => {
    const request = await open({
      "skills.library.mutate": new Error("Failed to remove skill"),
    });
    await click(button("Remove", detail()));
    await click(button("Remove", document.querySelector('[role="dialog"]')!));
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Failed to remove skill");
    expect(request).toHaveBeenCalledWith("skills.library.mutate", {
      skillId: LIBRARY_ENTRY.skillId,
      expectedRevision: LIBRARY_ENTRY.revision,
      action: "remove",
    });
  });
});
