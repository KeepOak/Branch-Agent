// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { GetCapabilitiesDialog, permissionWords } from "./get-capabilities";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A fixture, not a live catalogue: the plugin catalogue and skill library are not published yet.
const NONE = { network: false, files: "none", runCommands: false, secrets: false, computerControl: false };
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
    { id: "irc", catalog: { name: "IRC", summary: "Chat over IRC", permissions: { ...NONE, network: true, files: "workspace" } }, local: { installed: false, action: "install", install: { source: "clawhub", packageName: "irc-plugin" } } },
  ] },
  "skills.search": { results: [{ slug: "calendar-sync", displayName: "Calendar sync", summary: "Sync events", permissions: NONE }] },
  "trunks.template.list": { templates: [
    { id: "builder", source: "bundled", name: "Builder", description: "Edits a project's files", skills: 0, routines: 0, connections: [] },
    { id: "inbox-helper", source: "bundled", name: "Inbox Helper", description: "Sorts mail", skills: 0, routines: 0, connections: [] },
    { id: "researcher", source: "bundled", name: "Researcher", description: "Finds sources", skills: 0, routines: 0, connections: [] },
    { id: "imported:night-shift", source: "imported", name: "Night Shift", description: "Works overnight", skills: 1, routines: 2, connections: ["telegram"] },
  ] },
  "trunks.template.create": { ok: true, agentId: "night-shift", routines: [{ id: "j1", name: "Morning digest" }, { id: "j2", name: "Weekly review" }], connections: [{ id: "telegram", ready: false }, { id: "slack", ready: true }], warnings: [] },
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
  await act(async () => { root!.render(<GetCapabilitiesDialog engine={engine} close={() => {}} done={() => {}} />); });
  await act(async () => { await Promise.resolve(); });
  return request;
}
const rows = () => [...host.querySelectorAll<HTMLElement>('[data-testid="get-row"]')];
const rowNamed = (name: string) => rows().find(r => r.querySelector("b")?.textContent === name);
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await act(async () => { await Promise.resolve(); }); };
const tab = (name: string) => click(button(host, name));
const type = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { await Promise.resolve(); });
};
const names = () => rows().map(r => r.querySelector("b")?.textContent);

describe("Get capabilities", () => {
  it("opens on Skills with the three tags, and Plugins holds the plugin rows", async () => {
    await open();
    expect(names()).toEqual(["tax-helper", "notes", "Calendar sync"]);
    expect(rowNamed("notes")?.dataset.tag).toBe("Bundled");
    expect(rowNamed("tax-helper")?.dataset.tag).toBe("Installed");
    expect(rowNamed("Calendar sync")?.dataset.tag).toBe("Available");
    await tab("Plugins");
    expect(rowNamed("Files")?.dataset.tag).toBe("Bundled");
    expect(rowNamed("Slack")?.dataset.tag).toBe("Installed");
    expect(rowNamed("IRC")?.dataset.tag).toBe("Available");
    expect(visibleDevNotes(host)).toEqual([]);
  });

  it("shows the coming-later state on the tabs that are not built", async () => {
    await open();
    for (const name of ["Connectors", "Automations"]) {
      await tab(name);
      expect(rows()).toHaveLength(0);
      expect(host.textContent).toContain("Coming in a later update.");
    }
  });

  it("shows a plain-words permissions line only where the entry declares one", async () => {
    await open();
    await tab("Plugins");
    expect(rowNamed("IRC")?.querySelector(".get-perm")?.textContent).toBe("Can reach the network, read and write files in this Trunk's folder.");
    expect(rowNamed("Slack")?.querySelector(".get-perm")).toBeNull();
  });

  it("filters the Plugins tab by the search box", async () => {
    await open();
    await tab("Plugins");
    await type(host.querySelector<HTMLInputElement>('input[aria-label="Search plugins"]')!, "irc");
    expect(names()).toEqual(["IRC"]);
  });

  it("opens the install result at once and sends plugins.install with the catalogue spec", async () => {
    const request = await open();
    await tab("Plugins");
    await click(button(rowNamed("IRC")!, "Install"));
    expect(request).toHaveBeenCalledWith("plugins.install", { source: "clawhub", packageName: "irc-plugin", enable: true });
    expect(document.querySelector('[data-testid="get-result"]')?.getAttribute("aria-label")).toBe("Install IRC");
  });

  it("asks once before removing a plugin, then calls plugins.uninstall", async () => {
    const request = await open();
    await tab("Plugins");
    await click(button(rowNamed("Slack")!, "Remove"));
    expect(request).not.toHaveBeenCalledWith("plugins.uninstall", expect.anything());
    const confirm = document.querySelector('[data-testid="get-remove-confirm"]');
    expect(confirm?.getAttribute("aria-label")).toBe("Remove Slack?");
    expect(confirm?.textContent).toContain("Trunks lose its tools.");
    await click(button(confirm as HTMLElement, "Remove"));
    expect(request).toHaveBeenCalledWith("plugins.uninstall", { pluginId: "slack" });
  });

  it("greys out Remove for a skill, because the engine has no skill remove method", async () => {
    await open();
    const remove = button(rowNamed("tax-helper")!, "Remove") as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect(remove.dataset.reason).toBe("Needs the engine's skill remove method.");
    expect(button(rowNamed("notes")!, "Remove")).toBeUndefined();
  });

  it("keeps local rows when the catalogue fails", async () => {
    await open({ ...FIXTURE, "plugins.catalog.browse": new Error("offline") });
    await tab("Plugins");
    expect(rowNamed("Slack")?.dataset.tag).toBe("Installed");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("offline");
  });
});

describe("Get capabilities › Trunk templates", () => {
  const templateRows = () => [...host.querySelectorAll<HTMLElement>('[data-testid="template-row"]')];

  it("lists the bundled templates and the imported ones", async () => {
    await open();
    await tab("Trunk templates");
    expect(templateRows().map(r => [r.querySelector("b")?.textContent, r.dataset.source])).toEqual([
      ["Builder", "bundled"], ["Inbox Helper", "bundled"], ["Researcher", "bundled"], ["Night Shift", "imported"],
    ]);
    expect(templateRows()[3]?.textContent).toContain("2 routines · talks on telegram");
    expect(visibleDevNotes(host)).toEqual([]);
  });

  it("creates a Trunk from a catalog template and says its routines are off until approved", async () => {
    const request = await open();
    await tab("Trunk templates");
    await click(button(templateRows()[3]!, "Create Trunk"));
    expect(request).toHaveBeenCalledWith("trunks.template.create", { templateId: "imported:night-shift" });
    const result = document.querySelector('[data-testid="template-result"]');
    expect(result?.textContent).toContain("Its 2 routines are turned off until you approve them. Turn each on in Automations.");
    expect(result?.querySelector('[data-testid="template-connections"]')?.textContent).toContain("It talks on telegram, which is not set up on this computer yet.");
    expect(result?.textContent).toContain("Already set up here: slack.");
  });

  it("imports a pasted link with one tap", async () => {
    const request = await open();
    await tab("Trunk templates");
    await type(host.querySelector<HTMLInputElement>('input[aria-label="Template link"]')!, "  branch-template:1:abc  ");
    await click(button(host.querySelector('[data-testid="template-import"]')!, "Import"));
    expect(request).toHaveBeenCalledWith("trunks.template.create", { link: "branch-template:1:abc" });
    expect(document.querySelector('[data-testid="template-result"]')).toBeTruthy();
  });

  it("explains pasted text that is neither a link nor a template, and sends nothing", async () => {
    const request = await open();
    await tab("Trunk templates");
    await type(host.querySelector<HTMLInputElement>('input[aria-label="Template link"]')!, "hello");
    await click(button(host.querySelector('[data-testid="template-import"]')!, "Import"));
    expect(request).not.toHaveBeenCalledWith("trunks.template.create", expect.anything());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Paste a template link");
  });

  it("imports a picked template file as the template itself", async () => {
    const request = await open();
    await tab("Trunk templates");
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Import a template file"]')!;
    const template = { format: "branch.trunk-template", version: 1, name: "Night Shift", persona: { agentsMd: "# Night" }, skills: [], toolsets: {}, permissions: [] };
    const file = new File([JSON.stringify(template)], "night-shift.branch.trunk-template.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file] });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(request).toHaveBeenCalledWith("trunks.template.create", { template });
    expect(document.querySelector('[data-testid="template-result"]')?.getAttribute("aria-label")).toBe("Night Shift is ready");
  });
});

describe("permissionWords", () => {
  it("states what a manifest can reach, in plain words", () => {
    expect(permissionWords(NONE)).toBe("Asks for no permissions.");
    expect(permissionWords({ ...NONE, runCommands: true, secrets: true, computerControl: true })).toBe("Can run commands, use your saved secrets, control this computer.");
    expect(permissionWords(undefined)).toBeNull();
  });
});
