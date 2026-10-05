// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaplingSession } from "../connect/session";
import type { Actions } from "./conversation-actions";
import { useConversationMenu, type ConversationMenuProps } from "./ConversationMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// Each Trunk in the list is drawn with its face, which reads the reduced-motion setting.
const matchMedia = () => ({ matches: false, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() });
beforeEach(() => vi.stubGlobal("matchMedia", vi.fn(matchMedia)));
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

function Harness({ p }: { p: ConversationMenuProps }) {
  const menu = useConversationMenu(p);
  return (
    <>
      <button type="button" data-testid="who-it-knows-button" onClick={menu.whoItKnows}>people</button>
      {menu.node}
    </>
  );
}

function props(request: (method: string) => Promise<unknown>): ConversationMenuProps {
  const session = { request, getSnapshot: () => ({ sessionKey: "agent:sapling:main" }), engine: {} } as unknown as SaplingSession;
  return {
    session,
    url: "ws://127.0.0.1:1",
    ready: true,
    now: 0,
    row: null,
    isMain: true,
    title: "Sapling",
    trunk: { id: "sapling", name: "Sapling" },
    trunks: { defaultId: "sapling", list: [{ id: "sapling", name: "Sapling", isDefault: true }, { id: "fern", name: "Fern", isDefault: false }] },
    actions: {} as Actions,
    history: [],
    onRename: () => undefined,
    onDelete: () => undefined,
    openPlace: () => undefined,
    talkOff: null,
    onTalk: () => undefined,
    characterHidden: false,
    onShowCharacter: () => undefined,
    besideOpen: false,
    onBeside: () => undefined,
    onSplit: () => undefined,
    onAddComputer: () => undefined,
    onManageComputers: () => undefined,
  };
}

describe("the conversation header's Who it knows button", () => {
  it("reads the agent-to-agent policy, lists the Trunks under the button, and a second click closes it", async () => {
    const request = vi.fn(async (method: string) => (method === "config.get" ? { config: { tools: { agentToAgent: { enabled: true } } } } : {}));
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<Harness p={props(request)} />));
    const button = host.querySelector<HTMLButtonElement>("[data-testid=who-it-knows-button]");
    await act(async () => button?.click());
    expect(request).toHaveBeenCalledWith("config.get", {});
    const pop = document.querySelector("[data-testid=who-it-knows]");
    expect(pop?.textContent).toContain("Sapling knows and may talk to");
    expect(pop?.textContent).toContain("Fern");
    await act(async () => button?.click());
    expect(document.querySelector("[data-testid=who-it-knows]")).toBeNull();
  });

  it("says so when talking between Trunks is off", async () => {
    const request = vi.fn(async () => ({ config: { tools: { agentToAgent: { enabled: false } } } }));
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<Harness p={props(request)} />));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=who-it-knows-button]")?.click());
    expect(document.querySelector("[data-testid=who-it-knows]")?.textContent).toContain("talking between Trunks is off");
  });

  it("switches one target by writing deny without materializing an allow list", async () => {
    let deny: string[] = [];
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "config.get") return { hash: "h1", config: { agents: { entries: { sapling: { agentToAgent: { deny } } } } } };
      if (method === "config.patch") {
        deny = (JSON.parse((params as { raw: string }).raw) as { agents: { entries: { sapling: { agentToAgent: { deny: string[] } } } } }).agents.entries.sapling.agentToAgent.deny;
        return { ok: true };
      }
      return {};
    });
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<Harness p={props(request)} />));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=who-it-knows-button]")?.click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-testid=who-it-knows] button[role=menuitemcheckbox]")?.click());
    expect(deny).toEqual(["fern"]);
    expect(request).toHaveBeenCalledWith("config.patch", { baseHash: "h1", raw: JSON.stringify({ agents: { entries: { sapling: { agentToAgent: { deny: ["fern"] } } } } }) });
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=who-it-knows-button]")?.click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-testid=who-it-knows] button[role=menuitemcheckbox]")?.click());
    expect(deny).toEqual([]);
  });

  it("switches incoming access independently of outgoing access", async () => {
    let entries = { sapling: { agentToAgent: { deny: [] as string[] } }, fern: { agentToAgent: { deny: [] as string[] } } };
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "config.get") return { hash: "h1", config: { agents: { entries } } };
      if (method === "config.patch") {
        const patch = JSON.parse((params as { raw: string }).raw) as { agents: { entries: typeof entries } };
        entries = { ...entries, ...patch.agents.entries };
        return { ok: true };
      }
      return {};
    });
    const host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await act(async () => root?.render(<Harness p={props(request)} />));
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=who-it-knows-button]")?.click());
    expect(document.querySelector("[data-testid=who-it-knows]")?.textContent).toContain("May message Sapling");
    await act(async () => document.querySelectorAll<HTMLButtonElement>("[data-testid=who-it-knows] button[role=menuitemcheckbox]")[1]?.click());
    expect(entries.fern.agentToAgent.deny).toEqual(["sapling"]);
    expect(entries.sapling.agentToAgent.deny).toEqual([]);
    await act(async () => host.querySelector<HTMLButtonElement>("[data-testid=who-it-knows-button]")?.click());
    const switches = document.querySelectorAll<HTMLButtonElement>("[data-testid=who-it-knows] button[role=menuitemcheckbox]");
    expect(switches[0]?.getAttribute("aria-checked")).toBe("true");
    expect(switches[1]?.getAttribute("aria-checked")).toBe("false");
    await act(async () => switches[1]?.click());
    expect(entries.fern.agentToAgent.deny).toEqual([]);
    expect(entries.sapling.agentToAgent.deny).toEqual([]);
  });
});
