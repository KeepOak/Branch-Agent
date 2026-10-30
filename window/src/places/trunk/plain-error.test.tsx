// @vitest-environment jsdom
// Trunk pages: a raw engine failure reads as one plain sentence at Regular, exact words at Advanced.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { loadTrunkData } from "./data";
import { AccountsTab } from "./AccountsTab";
import { NewTrunkPreview } from "./NewTrunkPreview";
import { RemoveTrunkDialog } from "./RemoveTrunk";
import { ShareTrunkDialog } from "./ShareTrunk";
import { TrunkDefaults } from "./TrunkDefaults";
import { TrunkEditor } from "./TrunkEditor";
import { TrunkStudio } from "./TrunkStudio";
import type { Roster } from "./model";

vi.mock("../../face/Face", () => ({ Face: () => <span /> }));
vi.mock("../../face/CharacterFace", () => ({ CharacterFace: () => <span /> }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|unknown method|logbook\.status/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:18789";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";
const ROSTER: Roster = { defaultId: "oak", mainKey: "main", ownership: "", agents: [{ id: "oak", name: "Oak", theme: "", emoji: "", avatar: "", colour: "", shape: "", eyes: "", model: "", workspace: "", createdVia: "", creatorAgentId: "", runtime: "" }] };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  localStorage.clear();
});

function engineOf(request: (method: string, params?: unknown) => Promise<unknown>, scopes = ["operator.admin"]) {
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes } as unknown as WindowEngine;
}

const settle = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const alertText = () => [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "").join(" ");
const click = async (label: string) => {
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent === label);
  expect(button).toBeTruthy();
  await act(async () => button!.click());
  await settle();
};

describe("Trunk pages never show a raw engine error at Regular", () => {
  it("names a failed accounts read in a plain sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "models.authStatus") throw new Error(ENGINE);
      if (method === "config.get") return { hash: "h", valid: true, config: {} };
      return {};
    });
    await act(async () => root.render(<AccountsTab engine={engineOf(request)} agentId="oak" />));
    await settle();
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed account-order save in a plain sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "models.authOrderSet") throw new Error(ENGINE);
      if (method === "models.authStatus") return { providers: [{
        provider: "anthropic", displayName: "Claude", status: "ok", profileOrderStored: true,
        profileOrder: ["anthropic:one"],
        profiles: [{ profileId: "anthropic:one", type: "token", status: "ok" }],
      }] };
      if (method === "config.get") return { hash: "h", valid: true, config: {} };
      return {};
    });
    await act(async () => root.render(<AccountsTab engine={engineOf(request)} agentId="oak" />));
    await settle();
    await click("Use any");
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed Use my accounts toggle in a plain sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "config.patch") throw new Error(ENGINE);
      if (method === "config.get") return { hash: "h", valid: true, config: { agents: { entries: { oak: {} } } } };
      if (method === "models.authStatus") return { providers: [] };
      return {};
    });
    await act(async () => root.render(<AccountsTab engine={engineOf(request)} agentId="oak" />));
    await settle();
    await act(async () => document.querySelector<HTMLInputElement>('[data-testid="use-owner-accounts"]')!.click());
    await settle();
    expect(alertText()).toContain(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed remove in a plain sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "agents.list") return { defaultId: "oak", agents: [{ id: "birch", identity: { name: "Birch" } }] };
      if (method === "agents.delete") throw new Error(ENGINE);
      return {};
    });
    await act(async () => root.render(<RemoveTrunkDialog engine={engineOf(request)} agentId="birch" name="Birch" onClose={() => undefined} />));
    await click("Remove");
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed share export in a plain sentence", async () => {
    const request = vi.fn(async () => { throw new Error(ENGINE); });
    await act(async () => root.render(<ShareTrunkDialog engine={engineOf(request)} agentId="night" name="Night Shift" onClose={() => undefined} />));
    await settle();
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed defaults read in a plain sentence", async () => {
    const request = vi.fn(async () => { throw new Error(ENGINE); });
    await act(async () => root.render(<TrunkDefaults engine={engineOf(request)} />));
    await settle();
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed defaults save in a plain sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "config.patch") throw new Error(ENGINE);
      if (method === "config.get") return { hash: "h1", valid: true, config: { agents: { defaults: { bootstrapMaxChars: 20000 } } } };
      return {};
    });
    await act(async () => root.render(<TrunkDefaults engine={engineOf(request)} />));
    await settle();
    const input = document.querySelector<HTMLInputElement>('[aria-label="Longest instruction file"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "30000");
      input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await settle();
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed editor load in a plain sentence", async () => {
    const request = vi.fn(async () => { throw new Error(ENGINE); });
    await act(async () => root.render(<TrunkEditor engine={engineOf(request)} agentId="oak" level="regular" onClose={() => undefined} />));
    await settle();
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed editor save in a plain sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "agents.update") throw new Error(ENGINE);
      if (method === "agents.list") return { defaultId: "oak", mainKey: "main", agents: [{ id: "oak", identity: { name: "Oak" } }] };
      if (method === "config.get") return { hash: "h1", valid: true, config: { agents: { entries: { oak: {} } } } };
      if (method === "models.list") return { models: [] };
      if (method === "node.list") return { nodes: [] };
      return {};
    });
    await act(async () => root.render(<TrunkEditor engine={engineOf(request)} agentId="oak" level="regular" onClose={() => undefined} />));
    await settle();
    const name = document.querySelector<HTMLInputElement>(".tk-split input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "Juniper");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Save");
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed new-Trunk preview in a plain sentence", async () => {
    await act(async () => root.render(<NewTrunkPreview roster={ROSTER} error={ENGINE} onConfirm={() => undefined} onClose={() => undefined} />));
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
  });

  it("names a failed make-a-Trunk send in a plain sentence", async () => {
    const request = vi.fn(async () => { throw new Error(ENGINE); });
    await act(async () => root.render(<TrunkStudio engine={engineOf(request)} onClose={() => undefined} />));
    const box = document.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Watch renewals");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Propose it");
    expect(alertText()).toBe(REACH);
    expect(alertText()).not.toMatch(RAW);
    expect(document.querySelector('[data-testid="connect-model"]')).toBeNull();
  });

  it("keeps the connect-a-model notice when inference is missing", async () => {
    const request = vi.fn(async () => { throw new Error("Branch Agent could not verify a usable inference route. Check model setup and try again."); });
    await act(async () => root.render(<TrunkStudio engine={engineOf(request)} onClose={() => undefined} />));
    const box = document.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Watch renewals");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Propose it");
    expect(document.body.textContent).toContain("Connect a model to get answers");
    expect(document.body.textContent).not.toContain("could not verify a usable inference route");
    expect(document.querySelector('[data-testid="connect-model"]')).not.toBeNull();
  });

  it("plain-reads a partial models.list failure on the Trunk editor", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "models.list") throw new Error(ENGINE);
      if (method === "agents.list") return { defaultId: "oak", mainKey: "main", agents: [{ id: "oak", identity: { name: "Oak" } }] };
      if (method === "config.get") return { hash: "h1", valid: true, config: { agents: { entries: { oak: {} } } } };
      if (method === "node.list") return { nodes: [] };
      return {};
    });
    const data = await loadTrunkData(engineOf(request));
    expect(data.partial.join(" ")).toBe(REACH);
    expect(data.partial.join(" ")).not.toMatch(RAW);
    await act(async () => root.render(<TrunkEditor engine={engineOf(request)} agentId="oak" level="regular" onClose={() => undefined} />));
    await settle();
    const notes = [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent ?? "").join(" ");
    expect(notes).toContain(REACH);
    expect(notes).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    const request = vi.fn(async (method: string) => {
      if (method === "models.authStatus") throw new Error(ENGINE);
      if (method === "config.get") return { hash: "h", valid: true, config: {} };
      return {};
    });
    await act(async () => root.render(<AccountsTab engine={engineOf(request)} agentId="oak" />));
    await settle();
    expect(alertText()).toBe(ENGINE);
    await act(async () => root.render(<NewTrunkPreview roster={ROSTER} error={ENGINE} onConfirm={() => undefined} onClose={() => undefined} />));
    expect(alertText()).toBe(ENGINE);
    const share = vi.fn(async () => { throw new Error(ENGINE); });
    await act(async () => root.render(<ShareTrunkDialog engine={engineOf(share)} agentId="night" name="Night Shift" onClose={() => undefined} />));
    await settle();
    expect(alertText()).toBe(ENGINE);
    const remove = vi.fn(async (method: string) => {
      if (method === "agents.list") return { defaultId: "oak", agents: [{ id: "birch", identity: { name: "Birch" } }] };
      if (method === "agents.delete") throw new Error(ENGINE);
      return {};
    });
    await act(async () => root.render(<RemoveTrunkDialog engine={engineOf(remove)} agentId="birch" name="Birch" onClose={() => undefined} />));
    await click("Remove");
    expect(alertText()).toBe(ENGINE);
  });
});
