// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import { GetPluginsDialog } from "./get-plugins";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A fixture, not a live catalogue: the plugin catalogue and skill library are not published yet.
const FIXTURE: Record<string, unknown> = {
  "plugins.list": { plugins: [
    { id: "files", name: "Files", description: "Read and write files", origin: "bundled", installed: true, enabled: true },
    { id: "slack", name: "Slack", description: "Post to a channel", origin: "clawhub", installed: true, enabled: true },
  ] },
  "skills.status": { skills: [
    { name: "notes", skillKey: "notes", description: "Keep notes", bundled: true, eligible: true },
    { name: "tax-helper", skillKey: "tax-helper", description: "Tax steps", source: "workspace", eligible: true },
  ] },
  "plugins.catalog.browse": { items: [
    { id: "irc", catalog: { name: "IRC", summary: "Chat over IRC" }, local: { installed: false, action: "install", install: { source: "clawhub", packageName: "irc-plugin" } } },
  ] },
  "skills.search": { results: [{ slug: "calendar-sync", displayName: "Calendar sync", summary: "Sync events" }] },
};

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });

async function open(table: Record<string, unknown> = FIXTURE) {
  const request = vi.fn((method: string) => {
    const v = table[method];
    return v instanceof Error ? Promise.reject(v) : Promise.resolve(v ?? { ok: true });
  });
  const engine: WindowEngine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] };
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<GetPluginsDialog engine={engine} close={() => {}} done={() => {}} />); });
  await act(async () => { await Promise.resolve(); });
  return request;
}
const rows = () => [...host.querySelectorAll<HTMLElement>('[data-testid="get-row"]')];
const rowNamed = (name: string) => rows().find(r => r.querySelector("b")?.textContent === name);
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await act(async () => { await Promise.resolve(); }); };
const type = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { await Promise.resolve(); });
};

describe("Get plugins and skills", () => {
  it("tags every row Bundled, Installed or Available", async () => {
    await open();
    expect(rowNamed("Files")?.dataset.tag).toBe("Bundled");
    expect(rowNamed("notes")?.dataset.tag).toBe("Bundled");
    expect(rowNamed("Slack")?.dataset.tag).toBe("Installed");
    expect(rowNamed("tax-helper")?.dataset.tag).toBe("Installed");
    expect(rowNamed("IRC")?.dataset.tag).toBe("Available");
    expect(rowNamed("Calendar sync")?.dataset.tag).toBe("Available");
    expect(new Set(rows().map(r => r.dataset.tag))).toEqual(new Set(["Bundled", "Installed", "Available"]));
    expect(visibleDevNotes(host)).toEqual([]);
  });

  it("filters rows by the search box", async () => {
    await open();
    await type(host.querySelector<HTMLInputElement>('input[aria-label="Search plugins and skills"]')!, "irc");
    expect(rows().map(r => r.querySelector("b")?.textContent)).toEqual(["IRC"]);
  });

  it("opens the install result at once and sends plugins.install with the catalogue spec", async () => {
    const request = await open();
    await click(button(rowNamed("IRC")!, "Install"));
    expect(request).toHaveBeenCalledWith("plugins.install", { source: "clawhub", packageName: "irc-plugin", enable: true });
    const result = document.querySelector('[data-testid="get-result"]');
    expect(result?.getAttribute("aria-label")).toBe("Install IRC");
  });

  it("greys out Remove for a skill, because the engine has no skill remove method", async () => {
    await open();
    const remove = button(rowNamed("tax-helper")!, "Remove") as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect(remove.dataset.reason).toBe("Needs the engine's skill remove method.");
    expect(button(rowNamed("Files")!, "Remove")).toBeUndefined();
  });

  it("keeps local rows when the catalogue fails", async () => {
    await open({ ...FIXTURE, "plugins.catalog.browse": new Error("offline") });
    expect(rowNamed("Slack")?.dataset.tag).toBe("Installed");
    expect(rowNamed("notes")?.dataset.tag).toBe("Bundled");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("offline");
  });
});
