// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { CustomizeR1Place } from "./r1-place";
import { CUSTOMIZE_REQUEST_EVENT, requestCustomize, type CustomizeRequest, type PromptHandoff } from "./r1-request";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE: Record<string, unknown> = {
  "agents.list": { defaultId: "main", mainKey: "main", agents: [{ id: "main", name: "Sapling" }] },
  "config.get": { hash: "h1", sourceConfig: {}, runtimeConfig: {} },
  "skills.status": { skills: [{ name: "web", skillKey: "web", description: "Search", disabled: false, eligible: true, requirements: {}, missing: {} }] },
  "skills.gardener.status": { lastSuccessAtMs: null, counts: { active: 1, stale: 0, archived: 0 }, skills: [] },
  "skills.proposals.list": { proposals: [] },
  "skills.library.list": { entries: [{ slug: "weekly", description: "Weekly review", skillId: "s1" }, { slug: "old", removed: true }] },
  "plugins.list": { plugins: [] },
  "acpx.agents.list": { agents: [] },
  "tools.catalog": { groups: [] },
  "exec.approvals.get": { hash: "e1", file: { version: 1, agents: {} }, resolvedDefaults: { ask: "on-miss" } },
  "plugins.catalog.categories": { categories: [] },
  "plugins.catalog.browse": { items: [] },
  "seedbank.list": {},
};

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; requestCustomize({}); });

/** The engine spy of the last open(). */
let lastRequest: ReturnType<typeof vi.fn> = vi.fn();
async function open(level: Level = "regular", usePrompt?: PromptHandoff, extra: Record<string, unknown> = {}) {
  const table = { ...BASE, ...extra };
  const request = vi.fn((method: string) => Promise.resolve(table[method] ?? { ok: true }));
  lastRequest = request;
  const engine: WindowEngine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", scopes: ["operator.admin"] };
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<CustomizeR1Place engine={engine} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} level={level} usePrompt={usePrompt} />); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  return host;
}
const tabs = (scope: ParentNode) => [...scope.querySelectorAll("[aria-label=Customize] [role=tab]")].map(t => t.textContent?.trim());
const button = (text: string, scope: ParentNode = host) => [...scope.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await act(async () => { await Promise.resolve(); }); };

describe("Customize (R1): the place", () => {
  it("has the Personal | Community switch and no Trunks or Chat apps tab", async () => {
    await open();
    expect(tabs(host)).toEqual(["Personal", "Community"]);
    expect(button("Get capabilities")).toBeUndefined();
  });

  it("lists the seven kinds, Prompts included, and opens Skills first", async () => {
    await open();
    expect([...host.querySelectorAll("[data-kind]")].map(k => k.getAttribute("data-kind"))).toEqual(["Toolsets", "Connectors", "Skills", "Plugins", "Command-line tools", "Agents", "Prompts"]);
    expect(host.querySelector("[data-kind][aria-current=true]")?.getAttribute("data-kind")).toBe("Skills");
  });

  it("opens the kind a request names", async () => {
    requestCustomize({ kind: "Toolsets" });
    await open();
    expect(host.querySelector("[data-kind][aria-current=true]")?.getAttribute("data-kind")).toBe("Toolsets");
  });

  it("opens Community when the Seedbank pill asks for it, and switches back to Personal", async () => {
    requestCustomize({ mode: "community" });
    await open();
    expect(host.querySelector(".sb")).not.toBeNull();
    await click(button("Personal", host));
    expect(host.querySelector(".sb")).toBeNull();
    expect(host.querySelector("[data-kind]")).not.toBeNull();
  });

  it("switches to Community while it is already open", async () => {
    await open();
    expect(host.querySelector(".sb")).toBeNull();
    await act(async () => { requestCustomize({ mode: "community" }); });
    expect(host.querySelector(".sb")).not.toBeNull();
  });

  it("lists saved prompts and Use drops the command into the composer", async () => {
    const use = vi.fn();
    await open("regular", { ready: true, use });
    await click(host.querySelector("[data-kind=Prompts]"));
    expect(host.querySelector("[data-testid=prompts]")?.textContent).toContain("/weekly");
    expect(host.querySelector("[data-testid=prompts]")?.textContent).not.toContain("/old");
    expect(host.textContent).toContain("1 saved");
    await click(button("Use", host));
    expect(use).toHaveBeenCalledWith("/weekly ");
    expect(host.querySelector("[data-testid=prompts]")?.textContent).not.toContain("Copied");
  });

  it("says why Use is greyed when there is no default Trunk yet", async () => {
    await open("technical", { ready: false, use: vi.fn() });
    await click(host.querySelector("[data-kind=Prompts]"));
    const use = button("Use", host);
    expect(use?.getAttribute("data-coming")).toBe("Coming in a later update.");
    expect(use?.getAttribute("aria-disabled")).toBe("true");
  });

  it("hides a Coming control below Technical and tags it at Technical", async () => {
    await open("regular");
    expect(button("Look now")).toBeUndefined();
    await act(async () => { root!.unmount(); }); root = null; document.body.innerHTML = "";
    await open("technical");
    const look = button("Look now");
    expect(look?.getAttribute("data-coming")).toBe("Running the Gardener by hand comes in a later update.");
    expect(look?.getAttribute("aria-disabled")).toBe("true");
    expect(look?.title).toBe("Running the Gardener by hand comes in a later update.");
  });

  it("draws the kind head: the count, one ＋ Add, and the Get more link that opens Community on that kind", async () => {
    await open("regular");
    expect(host.querySelector("[data-kind-list=Skills] .cz-kindhead h2")?.textContent).toBe("Skills");
    expect(host.querySelector("[data-kind-list=Skills] .cz-kindhead p")?.textContent).toBe("Step-by-step know-how a Trunk can follow.");
    expect(host.querySelector("[data-kind-list=Skills] .cz-kindhead .cz-count")?.textContent).toBe("1 of 1 on");
    expect(host.querySelectorAll("[data-kind-list=Skills] .cz-add")).toHaveLength(1);
    await click(host.querySelector("[data-kind-list=Skills] .cz-add"));
    expect(community()).toEqual("skills");
  });
  it("sends Get more to the Community kind of the list it sits under", async () => {
    await open("regular");
    await click(host.querySelector("[data-kind=Connectors]"));
    expect(button("＋ Get more connectors in Community →")).toBeTruthy();
    await click(button("＋ Get more connectors in Community →"));
    expect(community()).toBe("mcp");
  });
  it("shows the For faces row with All and one face per Trunk, and the search hides rows that do not match", async () => {
    await open("regular");
    expect(host.querySelector(".cz-for-l")?.textContent).toBe("For:");
    expect([...host.querySelectorAll(".cz-face")].map(f => f.getAttribute("data-tip"))).toEqual(["Every Trunk", "Sapling’s tools"]);
    const search = host.querySelector<HTMLInputElement>('input[placeholder="Search tools, skills, agents…"]')!;
    expect(search).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "zzz");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelectorAll(".t9-kind[data-kind=Skills]")).toHaveLength(1);
    expect(host.querySelector("[data-kind-list=Skills] .t9-item")).toBeNull();
  });
  it("gives Skills the Library, Drafts and Suggested tabs, and the Advanced scope and buttons", async () => {
    await open("advanced");
    expect(tabs(host)).toEqual(["Personal", "Community"]);
    expect([...host.querySelectorAll("[aria-label=Skills] [role=tab]")].map(t => t.textContent)).toEqual(["Library", "Drafts", "Suggested"]);
    expect(button("Write a skill")).toBeUndefined();
    expect(button("Bring one in")).toBeTruthy();
    expect(button("Refresh")).toBeTruthy();
    expect(host.textContent).toContain("New conversations pick up to 150 skills by default.");
    expect([...host.querySelectorAll("[aria-label=Scope] button")].map(b => b.textContent)).toEqual(["Mine", "The team’s", "All", "A Trunk’s folder"]);
    expect(host.textContent).toContain("Skill bundles");
    expect(host.textContent).toContain("/month-end");
    await click(button("Suggested"));
    expect(host.textContent).toContain("Nothing suggested right now. The Gardener suggests better versions after a task goes well.");
  });
  it("gives each skill row its own on or off switch, and tags a project skill", async () => {
    const skills = { "skills.status": { skills: [{ name: "web", skillKey: "web", description: "Search", disabled: false, eligible: true, requirements: {}, missing: {}, source: "workspace" }] } };
    await open("regular", undefined, skills);
    const sw = host.querySelector('[role=switch][aria-label="web on or off"]');
    expect(sw).toBeTruthy();
    expect(host.querySelector(".cz-tag")?.textContent).toBe("This project");
  });
  it("opens the Plugin settings tab with its sections in the preview's order", async () => {
    const plugins = { "plugins.list": { plugins: [{ id: "pack", name: "Pack", installed: true, enabled: true, state: "ok", origin: "clawhub" }] }, "plugins.inspect": { ok: true, declared: {}, overview: {} } };
    await open("regular", undefined, plugins);
    await click(host.querySelector("[data-kind=Plugins]"));
    await click(button("Plugin settings", host));
    const titles = [...host.querySelectorAll(".cz-sec h2")].map(h => h.textContent);
    expect(titles).toEqual(["How it runs", "On in", "A start link", "Test against your tasks first", "Permissions"]);
  });
  it("shows the Found on this computer strip and the by-path field with its Add", async () => {
    await open("regular");
    await click(host.querySelector('[data-kind="Command-line tools"]'));
    expect(host.querySelector(".cz-found b")?.textContent).toBe("Found on this computer");
    expect(host.querySelector<HTMLInputElement>("#cz-clis-path")?.placeholder).toBe("Or add one by its path, like /usr/local/bin/rg");
    expect(button("Add", host)).toBeTruthy();
  });
  it("lists the three connector actions above Reload connectors", async () => {
    await open("regular", undefined, { "config.get": { hash: "h1", sourceConfig: { mcp: { servers: { gh: { url: "https://x.test" } } } }, runtimeConfig: { mcp: { servers: { gh: { url: "https://x.test" } } } } } });
    await click(host.querySelector('[data-kind="Connectors"]'));
    const labels = [...host.querySelectorAll(".cz-acts-top button, .cz-bar button")].map(b => b.textContent);
    expect(labels).toEqual(["Bring in from other apps", "Public registry", "Add your own server", "Reload connectors"]);
  });
  it("shows the Technical rows and Defaults for every Trunk only at Technical", async () => {
    await open("regular");
    expect(host.querySelector(".cz-tech")).toBeNull();
    expect(host.textContent).not.toContain("Defaults for every Trunk");
    await act(async () => { root!.unmount(); }); root = null; document.body.innerHTML = "";
    await open("technical");
    await click(host.querySelector("[data-kind=Skills]"));
    expect(host.querySelector("[data-tech=Skills]")?.textContent).toContain("Pinned skills");
    expect(host.textContent).toContain("Defaults for every Trunk");
  });
  it("opens Community on the kind a request names", async () => {
    await open("regular");
    await act(async () => { requestCustomize({ mode: "community", community: "mcp" }); });
    expect(host.querySelector(".sb")).not.toBeNull();
    expect([...host.querySelectorAll(".sb-chip")].find(c => c.getAttribute("aria-selected") === "true")?.textContent).toBe("Connectors");
  });
  it("lists the catalogue's groups a Trunk made under Made by Trunks", async () => {
    const catalog = { "tools.catalog": { groups: [{ id: "web", label: "Web", source: "core", tools: [{ id: "web_search", defaultProfiles: ["coding"] }] }, { id: "receipts", label: "Receipts", source: "trunk", tools: [{ id: "count_receipts", defaultProfiles: [] }] }] } };
    await open("regular", undefined, catalog);
    await click(host.querySelector("[data-kind=Toolsets]"));
    expect(host.querySelector("[data-kind-list=Toolsets] h3")?.textContent).toBe("Made by Trunks");
    expect(host.textContent).toContain("Receipts");
  });
  it("sends a plugin row's switch to plugins.setEnabled", async () => {
    const plugins = { "plugins.list": { plugins: [{ id: "pack", name: "Pack", installed: true, enabled: true, state: "ok", origin: "clawhub" }] } };
    await open("regular", undefined, plugins);
    await click(host.querySelector('[data-kind="Plugins"]'));
    await click(host.querySelector('[aria-label="Pack on or off"]'));
    expect(lastRequest).toHaveBeenCalledWith("plugins.setEnabled", { pluginId: "pack", enabled: false });
  });


  it("draws Specialists, How Trunks work together and the rest of the Agents kind in the preview's copy", async () => {
    await open("regular");
    await click(host.querySelector('[data-kind="Agents"]'));
    const heads = [...host.querySelectorAll("[data-kind-list=Agents] h3")].map(h => h.textContent);
    expect(heads).toEqual(["Connected agents", "Specialists", "How Trunks work together", "Other coding agents", "Built in", "Let specialists argue it out"]);
    expect(host.textContent).toContain("The pattern a room or a big task uses. Branch picks one; you can choose.");
    expect(host.textContent).toContain("Helpers a Trunk calls in for one job, then lets go.");
    expect(host.textContent).toContain("Any task, with the Trunk’s own tools · comes with Branch, can’t be edited");
    expect(host.querySelector('[data-coming="The pattern a room or a big task uses. Branch picks one; you can choose."]')).toBeNull();
  });
  it("orders the connector sheet as the preview does: who, what, set it up, safety, version, actions", async () => {
    await open("technical", undefined, { "config.get": { hash: "h1", sourceConfig: { mcp: { servers: { gh: { url: "https://x.test" } } } }, runtimeConfig: { mcp: { servers: { gh: { url: "https://x.test" } } } } } });
    await click(host.querySelector('[data-kind="Connectors"]'));
    const titles = [...host.querySelectorAll("[data-testid=connector-detail] .cz-sec h2")].map(h => h.textContent);
    expect(titles).toEqual(["Who may use it", "What it may do", "Set it up", "Safety check", "Version & updates", "Actions"]);
    expect(host.textContent).toContain("Where these are used");
    expect(host.textContent).toContain("Accounts");
  });
  it("orders the command-line tool sheet as the preview does", async () => {
    await open("regular", undefined, { "skills.status": { skills: [{ name: "gh", skillKey: "gh", description: "GitHub", disabled: false, eligible: true, requirements: { bins: ["gh"] }, missing: {} }] } });
    await click(host.querySelector('[data-kind="Command-line tools"]'));
    const titles = [...host.querySelectorAll("[data-testid=cli-detail] .cz-sec h2")].map(h => h.textContent);
    expect(titles).toEqual(["Who may use it", "What it may do", "Set it up", "Safety check", "Version & updates", "Actions"]);
  });
  it("orders the installed plugin sheet as the preview does", async () => {
    const plugins = { "plugins.list": { plugins: [{ id: "pack", name: "Pack", installed: true, enabled: true, state: "ok", origin: "clawhub" }] }, "plugins.inspect": { ok: true, declared: { skills: ["a"] }, overview: {} } };
    await open("regular", undefined, plugins);
    await click(host.querySelector('[data-kind="Plugins"]'));
    const titles = [...host.querySelectorAll("[data-testid=plugin-detail] .cz-sec h2")].map(h => h.textContent);
    expect(titles).toEqual(["Set it up", "Safety check", "Version & updates", "Actions"]);
  });
});

/** The Community kind the last request named (a listener set up once for the file). */
let lastCommunity: string | undefined;
addEventListener(CUSTOMIZE_REQUEST_EVENT, event => { lastCommunity = (event as CustomEvent<CustomizeRequest>).detail?.community; });
function community(): string | undefined {
  return lastCommunity;
}