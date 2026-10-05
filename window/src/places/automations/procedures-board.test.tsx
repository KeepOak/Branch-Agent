// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import type { Level } from "../../places-nav/level";
import { ProceduresTab, PROCEDURE_NEEDS } from "./Procedures";
import { BoardTab, ORCHARD_COLUMNS, ORCHARD_NEEDS } from "./Board";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null, host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
async function render(node: React.ReactNode) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(node); }); await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}
const byText = (t: string) => [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === t) as HTMLButtonElement;
function engine() {
  const request = vi.fn(async (method: string) => method === "config.get" ? { hash: "h", config: { commands: { native: "auto", bash: false } } } : { ok: true });
  return { request, engine: { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] } as WindowEngine };
}
describe("Procedures and Board", () => {
  it("Procedures greys what has no engine store, with the reason", async () => {
    await render(<ProceduresTab engine={engine().engine} level={"regular" as Level} />);
    expect(byText("Show a Trunk how, once").disabled).toBe(true); expect(byText("Show a Trunk how, once").title).toBe("");
    expect(byText("New prompt").disabled).toBe(true); expect(byText("New prompt").title).toBe("");
    expect(PROCEDURE_NEEDS.store).toMatch(/^Needs the engine/); expect(visibleDevNotes(host)).toEqual([]);
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
  it("Board draws Orchard's six columns empty, greyed with the reason, and opens Canopy", async () => {
    const openPlace = vi.fn();
    await render(<BoardTab openPlace={openPlace} />);
    expect([...host.querySelectorAll(".au-col h3")].map(h => h.firstChild?.textContent)).toEqual(ORCHARD_COLUMNS);
    expect(byText("Bring in issues").disabled).toBe(true); expect(byText("Bring in issues").title).toBe("");
    expect(host.textContent).not.toContain(ORCHARD_NEEDS); expect(visibleDevNotes(host)).toEqual([]);
    await act(async () => { byText("Open Canopy").click(); });
    expect(openPlace).toHaveBeenCalledWith("canopy");
  });
});
