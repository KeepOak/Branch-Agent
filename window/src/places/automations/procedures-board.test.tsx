// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import type { Level } from "../../places-nav/level";
import { ProceduresTab } from "./Procedures";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null, host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
async function render(node: React.ReactNode) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(node); }); await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
function engine() {
  const request = vi.fn(async (method: string) => method === "config.get" ? { hash: "h", config: { commands: { native: "auto", bash: false } } } : { ok: true });
  return { request, engine: { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as WindowEngine };
}
describe("Procedures", () => {
  it("Procedures draws only what works: no unbuilt button, prompt or recipe, and no developer note", async () => {
    await render(<ProceduresTab engine={engine().engine} level={"regular" as Level} />);
    expect(host.textContent).not.toContain("Show a Trunk how");
    expect(host.textContent).not.toContain("New prompt");
    expect(host.textContent).not.toContain("Recipe");
    expect(host.querySelectorAll("button").length).toBe(0);
    expect(visibleDevNotes(host)).toEqual([]);
    expect(host.textContent).not.toContain("Commands, technical");
  });
  it("Technical: Commands rows patch config commands", async () => {
    const { engine: e, request } = engine();
    await render(<ProceduresTab engine={e} level="technical" />);
    await act(async () => { (host.querySelector("[aria-label='Commands in chat apps’ menus'] [data-value='off']") as HTMLElement).click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(request).toHaveBeenCalledWith("config.patch", { baseHash: "h", raw: JSON.stringify({ commands: { native: false } }) });
    await act(async () => { (host.querySelector("[aria-label='/restart from chats']") as HTMLElement).click(); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(request).toHaveBeenCalledWith("config.patch", { baseHash: "h", raw: JSON.stringify({ commands: { restart: false } }) });
  });
});
