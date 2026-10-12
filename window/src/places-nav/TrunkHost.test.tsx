// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { TrunkHost, readOpenTrunk } from "./TrunkHost";

vi.mock("../places/trunk", () => ({
  TrunkProfile: ({ agentId }: { agentId: string }) => <div data-testid="profile">{agentId}</div>,
  TrunkEditor: ({ agentId }: { agentId: string }) => <div data-testid="editor">{agentId}</div>,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
const engine = { request: async () => ({}), onEvent: () => () => {}, sessionKey: null, scopes: [] } as unknown as WindowEngine;
const open = (detail: unknown) => act(async () => { window.dispatchEvent(new CustomEvent("branch:open-trunk", { detail })); });
async function mount() {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(<TrunkHost engine={engine} level="regular" openPlace={() => {}} />); });
}

describe("TrunkHost", () => {
  it("reads the request and defaults to the profile", () => {
    expect(readOpenTrunk({ agentId: "oak" })).toEqual({ agentId: "oak", view: "profile" });
    expect(readOpenTrunk({ agentId: "oak", view: "edit" })).toEqual({ agentId: "oak", view: "edit" });
    expect(readOpenTrunk({ view: "edit" })).toBeNull();
    expect(readOpenTrunk(null)).toBeNull();
  });
  it("opens the profile or the editor the event names", async () => {
    await mount();
    expect(document.querySelector("[data-testid=profile]")).toBeNull();
    await open({ agentId: "oak", view: "profile" });
    expect(document.querySelector("[data-testid=profile]")?.textContent).toBe("oak");
    await open({ agentId: "birch", view: "edit" });
    expect(document.querySelector("[data-testid=editor]")?.textContent).toBe("birch");
  });
  it("opens a request sent before the place mounted", async () => {
    await open({ agentId: "elm" });
    await mount();
    expect(document.querySelector("[data-testid=profile]")?.textContent).toBe("elm");
  });
});
