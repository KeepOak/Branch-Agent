// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import type { Level } from "../../places-nav/level";
import { CustomizePlace } from "./index";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label?: string }) => <span role="img" aria-label={label} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONFIG = {
  hash: "h1",
  sourceConfig: { agents: { entries: { main: {}, oak: { tools: { deny: ["github__*"] } } } }, mcp: { servers: { github: { url: "https://example.test/mcp" }, files: { command: "npx", args: ["files"], toolFilter: { exclude: ["write_file"] } } } } },
  runtimeConfig: { mcp: { servers: { github: { url: "https://example.test/mcp" }, files: { command: "npx", args: ["files"], toolFilter: { exclude: ["write_file"] } } } } },
};
const BASE: Record<string, unknown> = {
  "agents.list": { defaultId: "main", mainKey: "main", agents: [{ id: "main", name: "Sapling" }, { id: "oak", name: "Oak" }] },
  "config.get": CONFIG,
  "tools.effective": { groups: [{ source: "mcp", tools: [{ id: "github__search_code", mcpServer: "github", mcpToolName: "search_code" }] }] },
  "skills.status": { skills: [
    { name: "web", skillKey: "web", description: "Search", disabled: false, eligible: true, requirements: { bins: ["curl"] }, missing: {} },
    { name: "voice", skillKey: "voice", description: "Speak", disabled: false, eligible: false, requirements: { bins: ["ffmpeg"] }, missing: { bins: ["ffmpeg"] }, install: [{ id: "brew", label: "Install ffmpeg" }] },
    { name: "maps", skillKey: "maps", description: "Places", disabled: true, eligible: true },
  ] },
  "skills.gardener.status": { lastSuccessAtMs: null, counts: { active: 2, stale: 1, archived: 0 }, skills: [] },
  "skills.proposals.list": { proposals: [{ id: "p1", kind: "update", status: "pending", title: "t", description: "Better.", skillName: "web", revisionHash: "f".repeat(64), createdAt: "" }] },
  "skills.library.list": { entries: [] },
  "plugins.list": { plugins: [{ id: "pack", name: "Pack", installed: true, enabled: false, state: "disabled", origin: "bundled" }] },
  "plugins.inspect": { ok: true, declared: { skills: ["a"] }, overview: {} },
  "acpx.agents.list": { agents: [{ id: "opencode", name: "OpenCode", runtimeId: "acp-opencode", installation: "installed", enabled: true }] },
  "tools.catalog": { groups: [{ id: "web", label: "Web", source: "core", tools: [{ id: "web_search", defaultProfiles: ["coding", "full"] }] }] },
  "exec.approvals.get": { hash: "e1", file: { version: 1, agents: {} }, resolvedDefaults: { ask: "on-miss" } },
  "plugins.catalog.categories": { categories: [] },
  "plugins.catalog.browse": { items: [{ id: "linear", catalog: { name: "Linear", summary: "Issues", packageName: "@linear/branch", categories: [] }, local: { installed: false, enabled: false, action: "install" } }] },
};

let root: Root | null = null;
let host: HTMLDivElement;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });

async function open(kind: string, fx: Record<string, unknown> = {}, level: Level = "regular", sessionKey: string | null = "agent:main:main") {
  const table = { ...BASE, ...fx };
  const request = vi.fn((method: string) => {
    const v = table[method];
    if (v instanceof Error) return Promise.reject(v);
    return Promise.resolve(typeof v === "function" ? (v as () => unknown)() : v ?? { ok: true });
  });
  const engine: WindowEngine = { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey, scopes: ["operator.admin"] };
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => { root!.render(<CustomizePlace engine={engine} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} level={level} />); });
  await act(async () => { dispatchEvent(new CustomEvent("branch:place-tab", { detail: { place: "customize", tab: kind } })); });
  await act(async () => { await Promise.resolve(); });
  return request;
}
const button = (text: string, scope: ParentNode = host) => [...scope.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
const click = async (el: Element | null | undefined) => { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await act(async () => { await Promise.resolve(); }); };
const patches = (request: ReturnType<typeof vi.fn>) => request.mock.calls.filter(([m]) => m === "config.patch").map(([, p]) => ({ ...(p as object), raw: JSON.parse((p as { raw: string }).raw) }));

describe("Tools, three panes", () => {
  it("lists the kinds with counts and the Whose tools chips, Connectors first", async () => {
    await open("Connectors");
    expect([...host.querySelectorAll("[data-kind]")].map(k => k.getAttribute("data-kind"))).toEqual(["Connectors", "Skills", "Plugins", "Command-line tools", "Agents", "Toolsets"]);
    expect(host.querySelector('[data-kind="Connectors"] em')?.textContent).toBe("2");
    expect(host.querySelector('[data-kind="Skills"] em')?.textContent).toBe("1");
    expect([...host.querySelectorAll(".cz-whose .cz-chip")].map(c => c.textContent)).toEqual(["Every Trunk", "Sapling", "Oak"]);
    expect(button("Add a server")).toBeTruthy();
  });
  it("switches a connector off and limits which Trunks may use it, through config.patch", async () => {
    const request = await open("Connectors");
    await click(host.querySelector('[aria-label="files on or off"]'));
    expect(patches(request)[0]).toEqual({ raw: { mcp: { servers: { files: { enabled: false } } } }, baseHash: "h1" });
    await click([...host.querySelectorAll(".t9-item")].find(i => i.textContent?.includes("github")));
    await click(button("Oak", host.querySelector('[aria-label="Which Trunks may use it"]')!));
    expect(patches(request)[1]).toEqual({ raw: { agents: { entries: { oak: { tools: { deny: [] } } } } }, baseHash: "h1", replacePaths: ["agents.entries.oak.tools.deny"] });
  });
  it("sets a tool to Never with toolFilter.exclude and greys Ask first", async () => {
    const request = await open("Connectors");
    await click([...host.querySelectorAll(".t9-item")].find(i => i.textContent?.includes("github")));
    const row = host.querySelector('[aria-label="search_code"]')!;
    expect(button("Ask first", row)!.disabled).toBe(true);
    expect(button("Ask first", row)!.title).toContain("per-tool ask");
    await click(button("Never", row));
    expect(patches(request).at(-1)).toEqual({ raw: { mcp: { servers: { github: { toolFilter: { exclude: ["search_code"] } } } } }, baseHash: "h1", replacePaths: ["mcp.servers.github.toolFilter.exclude"] });
  });
  it("shows Connection only from Advanced, and the empty line with no servers", async () => {
    await open("Connectors");
    expect(host.textContent).not.toContain("Several calls at once");
    if (root) await act(async () => root!.unmount()); document.body.innerHTML = "";
    await open("Connectors", {}, "advanced");
    expect(host.textContent).toContain("Several calls at once");
    if (root) await act(async () => root!.unmount()); document.body.innerHTML = "";
    await open("Connectors", { "config.get": { hash: "h", sourceConfig: {}, runtimeConfig: {} } });
    expect(host.textContent).toContain("No connectors yet.");
  });
  it("says why Test it and Check for updates are greyed, with and without a server", async () => {
    await open("Connectors", { "config.get": { hash: "h", sourceConfig: {}, runtimeConfig: {} } });
    expect(button("Test it")!.disabled).toBe(true);
    expect(button("Test it")!.title).toBe("Add a server first");
    expect(button("Check for updates")!.disabled).toBe(true);
    expect(button("Check for updates")!.title).toBe("Add a server first");
    expect(host.textContent).toContain("Add a server first");
    expect(visibleDevNotes(host)).toEqual([]);
    if (root) await act(async () => root!.unmount()); document.body.innerHTML = "";
    await open("Connectors");
    expect(button("Test it")!.disabled).toBe(true);
    expect(button("Test it")!.title).toBe("This connector cannot be tested yet.");
    expect(button("Check for updates")!.disabled).toBe(true);
    expect(button("Check for updates")!.title).toBe("This connector cannot be checked for updates yet.");
    expect(host.textContent).toContain("This connector cannot be tested yet.");
    expect(host.textContent).toContain("This connector cannot be checked for updates yet.");
    expect(visibleDevNotes(host.querySelector(".cz-acts")!)).toEqual([]);
  });
  it("installs from the connector catalogue with plugins.install", async () => {
    const request = await open("Connectors");
    await click(button("Add a server"));
    expect(request).toHaveBeenCalledWith("plugins.catalog.browse", { intent: "all", pageSize: 60 });
    await click(button("Install", host.querySelector('[data-testid="catalog"]')!));
    expect(request).toHaveBeenCalledWith("plugins.install", { source: "clawhub", packageName: "@linear/branch", enable: true });
    expect(button("Public registry")!.disabled).toBe(true);
  });
});

describe("Tools › Skills", () => {
  it("filters by state, switches a skill and keeps a suggestion with its revision", async () => {
    const request = await open("Skills");
    expect(button("Needs setup 1")).toBeTruthy();
    await click(button("Off 1"));
    expect(host.querySelectorAll(".t9-item")).toHaveLength(1);
    await click(host.querySelector('[aria-label="maps on or off"]'));
    expect(request).toHaveBeenCalledWith("skills.update", { skillKey: "maps", enabled: true });
    await click(button("Keep it"));
    expect(request).toHaveBeenCalledWith("skills.proposals.apply", { proposalId: "p1", expectedRevisionHash: "f".repeat(64) });
    expect(button("Look now")!.disabled).toBe(true);
  });
  it("installs what a skill needs and searches the skill library", async () => {
    const request = await open("Skills", { "skills.search": { results: [{ slug: "notes", installRef: "@a/notes", displayName: "Notes" }] } });
    await click(button("Needs setup 1"));
    await click(button("Install ffmpeg"));
    expect(request).toHaveBeenCalledWith("skills.install", { name: "voice", installId: "brew" });
    await click(button("Add a skill"));
    const provs = [...document.querySelectorAll<HTMLElement>(".cz-provs .cz-prov")];
    for (const label of ["Choose a file", "Add from GitHub", "Draft it"]) { expect(button(label)!.disabled).toBe(true); expect(button(label)!.title).toBe(""); }
    expect(provs.every(p => p.title === "")).toBe(true); expect(visibleDevNotes(document.body)).toEqual([]);
    await click(button("From the skill librarySearch skills others have shared and install one."));
    await click(button("Install"));
    expect(request).toHaveBeenCalledWith("skills.install", { source: "clawhub", slug: "@a/notes" });
  });
  it("shows the read error instead of an empty list", async () => {
    await open("Skills", { "skills.status": new Error("Disconnected") });
    expect(host.textContent).toContain("Disconnected");
    expect(host.textContent).not.toContain("No skills match.");
  });
});

describe("Tools › Plugins, Agents, Toolsets, Command-line tools", () => {
  it("asks for the engine's capability review before turning a plugin on", async () => {
    let calls = 0;
    const refusal = Object.assign(new Error("Pack wants to do more."), { details: { capabilityConsentCode: "PLUGIN_CAPABILITY_CONSENT_REQUIRED", reviewToken: "rt" } });
    const request = await open("Plugins", { "plugins.setEnabled": () => (++calls === 1 ? Promise.reject(refusal) : { ok: true }) });
    await click(host.querySelector('[aria-label="Pack on or off"]'));
    expect(host.textContent).toContain("Pack wants to do more.");
    await click(button("Allow"));
    expect(request).toHaveBeenCalledWith("plugins.setEnabled", { pluginId: "pack", enabled: true, acknowledgeCapabilities: { reviewToken: "rt" } });
  });
  it("switches a coding agent in config", async () => {
    const request = await open("Agents");
    await click(host.querySelector('[aria-label="OpenCode on or off"]'));
    expect(patches(request)[0].raw).toEqual({ plugins: { entries: { acpx: { config: { nativeAgents: { opencode: false } } } } } });
  });
  it("sets the starting set and turns a toolset off for every Trunk", async () => {
    const request = await open("Toolsets");
    await click(button("Coding"));
    expect(patches(request)[0].raw).toEqual({ tools: { profile: "coding" } });
    await click(host.querySelector('[aria-label="Web on or off"]'));
    expect(patches(request)[1]).toEqual({ raw: { tools: { deny: ["group:web"] } }, baseHash: "h1", replacePaths: ["tools.deny"] });
  });
  it("lists the programs skills need, with what is missing", async () => {
    await open("Command-line tools");
    expect([...host.querySelectorAll(".t9-item b")].map(b => b.textContent)).toEqual(["curl", "ffmpeg"]);
    expect(host.textContent).toContain("Not found");
    expect((host.querySelector('[aria-label="Ask before each command"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
