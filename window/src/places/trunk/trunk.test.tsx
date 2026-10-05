// @vitest-environment jsdom
import { act } from "react";
import { visibleDevNotes } from "../../shell/shown-why.testing";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { TrunksTab } from "../customize/trunks";
import { Jobs } from "../customize/jobs";
import { TrunkEditor } from "./TrunkEditor";
import { TrunkProfile } from "./TrunkProfile";
import { TrunkStudio } from "./TrunkStudio";
import { newTrunkName, removeTrunk, updateParams } from "./api";
import { readMay } from "./may";
import { LOOKS, lookOf, readConfig, readRoster } from "./model";
import { readFacts, scheduleText } from "./profile-data";

vi.mock("../../face/Face", () => ({ Face: ({ label, size }: { label?: string; size: number }) => <span role="img" aria-label={label} data-face-size={size} /> }));
vi.mock("../../face/CharacterFace", () => ({ CharacterFace: ({ label, size }: { label?: string; size: number }) => <span role="img" aria-label={label} data-character-size={size} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; localStorage.clear(); });
async function mount(node: React.ReactNode) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => { root!.render(node); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const engine = (request: ReturnType<typeof vi.fn>, scopes = ["operator.admin"]): WindowEngine => ({ request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes });
const byText = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;
async function click(el: Element | null | undefined) { expect(el).toBeTruthy(); await act(async () => { (el as HTMLElement).click(); }); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
async function type(el: HTMLInputElement, value: string) {
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
}

const ROSTER = { defaultId: "oak", mainKey: "main", agents: [{ id: "oak", identity: { name: "Oak", theme: "Helps" } }, { id: "birch", identity: { name: "Birch", theme: "Reads", avatar: "branch:ember" }, model: { primary: "p/one" } }] };
const CONFIG = { hash: "h1", valid: true, config: { agents: { entries: { oak: { default: true }, birch: { tools: { deny: ["exec"] } } } } } };
function fake(extra: Record<string, unknown> = {}) {
  let created: string | undefined;
  return vi.fn((method: string, _params?: unknown) => {
    if (method === "agents.create") created = (extra[method] as { agentId?: string } | undefined)?.agentId;
    const roster = created ? { ...ROSTER, agents: [...ROSTER.agents, { id: created }] } : ROSTER;
    return Promise.resolve(method in extra ? extra[method] : method === "agents.list" ? roster : method === "config.get" ? CONFIG
    : method === "models.list" ? { models: [{ id: "one", provider: "p", name: "One", available: true }, { id: "two", provider: "p", name: "Two", available: true }] }
    : method === "node.list" ? { nodes: [{ nodeId: "n1", displayName: "Box", platform: "linux", paired: true, connected: true }] }
    : method === "tools.github.status" ? { agentId: "oak", selectedScope: "agent", selected: { scope: "agent", configured: false, identity: null }, effective: null } : { ok: true });
  });
}

describe("Trunk data", () => {
  it("offers only looks with art, with Cobble for the pebble character and no Branch", () => {
    expect(LOOKS.map((l) => l.id)).toEqual(["classic", "ember", "tock", "kite", "morel", "pebble", "wisp", "lumen", "tide", "juniper", "bolt", "sorrel", "skein", "nib"]);
    expect(LOOKS.find((l) => l.id === "pebble")?.name).toBe("Cobble");
    expect(lookOf("branch:tock", "Oak")).toBe("tock");
    expect(lookOf("classic", "Oak")).toBe("classic");
  });
  it("reads switches from the entry and the rules for every Trunk", () => {
    const snap = readConfig({ hash: "h", config: { tools: { deny: ["browser"] }, agents: { entries: { a: { tools: { fs: { workspaceOnly: true } } } } } } });
    expect(readMay(snap, "a")).toMatchObject({ read: false, browse: false, browseLock: expect.stringContaining("every Trunk") });
  });
  it("writes false, not null, to turn reading on against the rule for every Trunk", async () => {
    const { mayChanges } = await import("./may");
    const snap = readConfig({ hash: "h", config: { tools: { fs: { workspaceOnly: true } }, agents: { entries: { a: {} } } } });
    const was = readMay(snap, "a");
    expect(mayChanges(snap, "a", was, { ...was, read: true }, "")).toEqual({ "agents.entries.a.tools.fs.workspaceOnly": false });
  });
  it("names a new Trunk with a free name and sends only changed identity fields", () => {
    expect(newTrunkName(readRoster({ agents: [{ id: "new-trunk", identity: { name: "New Trunk" } }] }))).toBe("New Trunk 2");
    const may = readMay(readConfig(CONFIG), "birch");
    const was = { name: "Birch", theme: "", look: "ember", emoji: "", model: "p/one", may };
    expect(updateParams("birch", was, was)).toBeNull();
    expect(updateParams("birch", was, { ...was, look: "classic", emoji: "🦉" })).toEqual({ agentId: "birch", avatar: "classic", emoji: "🦉" });
    expect(scheduleText({ kind: "cron", expr: "0 8 * * *" })).toBe("Every day at 8:00 AM");
    expect(scheduleText({ kind: "cron", expr: "*/30 * * * *" })).toBe("Every 30 minutes");
    expect(readFacts({ file: { name: "MEMORY.md", content: ["# Notes", "- Pays rent on the 1st", "  from the joint account", "- Prefers aisle seats", ""].join("\n") } }, "scout")).toBe(2);
    expect(readFacts({ file: { name: "MEMORY.md", missing: true } }, "scout")).toBe(0);
    expect(readFacts({}, "scout")).toBeNull();
  });
});

describe("Trunk editor", () => {
  it("greys colour, shape, eyes and Shuffle on the Look tab, without the developer note", async () => {
    await mount(<TrunkEditor engine={engine(fake())} agentId="birch" level="regular" onClose={() => {}} />);
    await click(document.querySelector('[aria-label^="Classic pebble"]'));
    const fields = [...document.querySelectorAll<HTMLElement>(".tk-field")].filter((f) => ["Colour", "Shape", "Eyes"].includes(f.querySelector(".tk-label")?.textContent ?? ""));
    expect(fields).toHaveLength(3);
    for (const f of fields) { expect(f.title).toBe(""); expect([...f.querySelectorAll("button")].every((b) => b.disabled)).toBe(true); }
    for (const s of document.querySelectorAll<HTMLButtonElement>(".tk-shape")) expect(s.title).toBe(s.getAttribute("aria-label"));
    expect(document.querySelector(".tk-why")).toBeNull();
    expect(byText("Shuffle").disabled).toBe(true); expect(byText("Shuffle").title).toBe("");
    expect(visibleDevNotes(document.body)).toEqual([]);
  });
  it("saves the look through agents.update, then what it's for and its rules in one config.patch", async () => {
    const request = fake();
    await mount(<TrunkEditor engine={engine(request)} agentId="birch" level="regular" onClose={() => {}} />);
    await click(document.querySelector('[aria-label="Tock"]'));
    await type(document.querySelectorAll<HTMLInputElement>(".tk-split input")[1], "Money");
    await click(byText("What it may do"));
    await click(document.querySelector('[aria-label="Use the browser"]'));
    const send = [...document.querySelectorAll<HTMLElement>(".tk-ctl")].find(r => r.querySelector("b")?.textContent === "Send email and messages")!;
    expect(send.classList.contains("off")).toBe(true); expect(send.title).toBe("");
    expect(send.textContent).toContain("Overrides the mode for this Trunk only."); expect([...send.querySelectorAll("button")].every(b => b.disabled)).toBe(true);
    expect(visibleDevNotes(document.body)).toEqual([]);
    await click(byText("Its computers"));
    await click(document.querySelector('[data-value="n1"]'));
    await click(byText("Save"));
    expect(request).toHaveBeenCalledWith("agents.update", { agentId: "birch", avatar: "branch:tock" });
    const patch = request.mock.calls.find(([m]) => m === "config.patch")!;
    expect(patch[1]).toEqual({ baseHash: "h1", raw: JSON.stringify({ agents: { entries: { birch: { tools: { deny: ["exec", "browser"], exec: { host: "node", node: "n1" } }, identity: { theme: "Money" } } } } }) });
  });
  it("greys colour, shape, eyes and Shuffle with the reason and shows Advanced rows only from Advanced", async () => {
    await mount(<TrunkEditor engine={engine(fake())} agentId="oak" level="regular" onClose={() => {}} />);
    expect(byText("Shuffle").disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Circle"]')?.disabled).toBe(true);
    await click(byText("What it may do"));
    expect(document.body.textContent).not.toContain("Model for decisions");
    await act(async () => root!.unmount()); root = null; document.body.innerHTML = "";
    await mount(<TrunkEditor engine={engine(fake())} agentId="oak" level="advanced" tab="may" onClose={() => {}} />);
    expect(document.body.textContent).toContain("Model for decisions");
  });
  it("keeps Save off for a window without the owner's rights", async () => {
    await mount(<TrunkEditor engine={engine(fake(), [])} agentId="oak" level="regular" onClose={() => {}} />);
    await type(document.querySelectorAll<HTMLInputElement>(".tk-split input")[0], "Elm");
    expect(byText("Save").disabled).toBe(true);
  });
});

describe("Customize › Trunks", () => {
  const tab = (request: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) => (
    <TrunksTab engine={engine(request)} level="regular" openConversation={() => {}} trunks={{ data: ROSTER as never, loading: false, error: null, reload: () => {} }} {...extra} />);
  it("opens directional Who it knows controls for a Trunk", async () => {
    const request = fake();
    await mount(tab(request));
    await click(document.querySelectorAll<HTMLButtonElement>(".tk-row .btn.ghost")[0]);
    const pop = document.querySelector("[data-testid=who-it-knows]");
    expect(pop?.textContent).toContain("Oak knows and may talk to");
    expect(pop?.textContent).toContain("May message Oak");
    await click(pop?.querySelectorAll("button[role=menuitemcheckbox]")[1]);
    expect(request).toHaveBeenCalledWith("config.patch", { baseHash: "h1", raw: JSON.stringify({ agents: { entries: { birch: { agentToAgent: { deny: ["oak"] } } } } }) });
  });
  it("adds a Trunk with agents.create and starts its conversation through the shell", async () => {
    const request = fake({ "agents.create": { ok: true, agentId: "new-trunk" } }), start = vi.fn();
    await mount(tab(request, { startConversation: start }));
    await click(byText("A new Trunk"));
    expect(request).toHaveBeenCalledWith("agents.create", { name: "New Trunk" });
    expect(start).toHaveBeenCalledWith("new-trunk");
    const asked = vi.fn();
    window.addEventListener("branch:new-group-chat", asked);
    await click(byText("New group chat"));
    window.removeEventListener("branch:new-group-chat", asked);
    expect(asked).toHaveBeenCalledTimes(1);
    expect(byText("Pause").disabled).toBe(true); expect(byText("Pause").title).toBe(""); expect(visibleDevNotes(document.body)).toEqual([]);
  });
  it("opens the new Trunk's profile when the shell hands over no way to start its conversation", async () => {
    const request = fake({ "agents.create": { ok: true, agentId: "new-trunk" } });
    await mount(tab(request));
    await click(byText("A new Trunk"));
    expect(document.querySelector('[data-testid="trunk-profile"]')).toBeTruthy();
    expect(request.mock.calls.some(([m]) => m === "sessions.create")).toBe(false);
  });
  it("removes a Trunk from its row menu after a confirm, with no Undo", async () => {
    const request = fake();
    await mount(tab(request));
    const row = document.querySelectorAll(".tk-row")[1];
    await act(async () => { row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 })); });
    await click(byText("Remove Birch…"));
    expect(document.body.textContent).toContain("move to the Trash");
    await click(document.querySelector('[data-testid="trunk-remove"] .btn.bad'));
    expect(request).toHaveBeenCalledWith("agents.delete", { agentId: "birch" });
    expect(document.body.textContent).not.toContain("Undo");
  });
  it("blocks the default Trunk and reports each failed file move", async () => {
    const request = fake({ "agents.delete": { ok: true, failed: [{ path: "notes.md", reason: "locked" }], purgeFailed: true } });
    await expect(removeTrunk(engine(request), "oak")).rejects.toThrow("default Trunk");
    expect(request).not.toHaveBeenCalledWith("agents.delete", expect.anything());
    await mount(tab(request));
    expect(byText("Remove").disabled).toBe(true);
    const row = document.querySelectorAll(".tk-row")[1];
    await act(async () => { row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 })); });
    await click(byText("Remove Birch…"));
    await click(document.querySelector('[data-testid="trunk-remove"] .btn.bad'));
    expect(document.body.textContent).not.toContain("Undo");
    expect(await removeTrunk(engine(request), "birch")).toEqual({ failed: ["notes.md: locked"], purgeFailed: true });
  });
  it("saves the contact default in one patch, including explicit ownership", async () => {
    const request = fake();
    await mount(tab(request));
    await act(async () => { document.querySelectorAll(".tk-row")[1].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 })); });
    await click(byText("Make default"));
    expect(request).toHaveBeenCalledWith("config.patch", { baseHash: "h1", raw: JSON.stringify({ agents: { defaultId: "birch" } }) });
    await act(async () => root!.unmount()); root = null; document.body.innerHTML = "";
    await mount(<TrunksTab engine={engine(fake())} level="regular" openConversation={() => {}} trunks={{ data: { ...ROSTER, ownership: "explicit" } as never, loading: false, error: null, reload: () => {} }} />);
    await act(async () => { document.querySelectorAll(".tk-row")[1].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 })); });
    expect(byText("Make default").disabled).toBe(false);
  });
  it("shows Defaults for every Trunk only at Technical and patches a number", async () => {
    const request = fake();
    await mount(tab(request));
    expect(document.body.textContent).not.toContain("Defaults for every Trunk");
    await act(async () => root!.unmount()); root = null; document.body.innerHTML = "";
    await mount(tab(request, { level: "technical" }));
    const input = document.querySelector<HTMLInputElement>('[aria-label="Longest instruction file"]')!;
    expect(input.placeholder).toBe("20000");
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "30000"); input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(request).toHaveBeenCalledWith("config.patch", { baseHash: "h1", raw: JSON.stringify({ agents: { defaults: { bootstrapMaxChars: 30000 } } }) });
  });
});

describe("job creation across gateway replacement", () => {
  it("enables creation on the new engine and cannot let the retired request clear its busy state", async () => {
    let finishOld!: (value: unknown) => void, finishNew!: (value: unknown) => void;
    const oldRequest = vi.fn(() => new Promise((resolve) => { finishOld = resolve; }));
    const newRequest = vi.fn((method: string) => method === "agents.create"
      ? new Promise((resolve) => { finishNew = resolve; })
      : Promise.resolve(method === "agents.list" ? { agents: [{ id: "expense-manager" }] }
        : method === "agents.files.get" ? { file: { missing: true } } : { ok: true }));
    await mount(<Jobs engine={engine(oldRequest)} reload={() => {}} />);
    await click(document.querySelector('[aria-label="Use this job: Inbox Manager"]'));
    const replacement = engine(newRequest);
    await act(async () => { root!.render(<Jobs engine={replacement} reload={() => {}} />); });
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Use this job: Expense Manager"]')!.disabled).toBe(false);
    await click(document.querySelector('[aria-label="Use this job: Expense Manager"]'));
    await act(async () => { finishOld({ ok: true, agentId: "inbox-manager" }); });
    expect(document.querySelector<HTMLButtonElement>('[aria-label="Use this job: Expense Manager"]')!.disabled).toBe(true);
    expect(document.body.textContent).not.toContain("Inbox Manager is ready.");
    await act(async () => { finishNew({ ok: true, agentId: "expense-manager" }); });
    expect(document.body.textContent).toContain("Expense Manager is ready.");
    expect(oldRequest).toHaveBeenCalledTimes(1);
    expect(newRequest).toHaveBeenCalledWith("agents.files.set", expect.objectContaining({ agentId: "expense-manager", expectedMissing: true }));
  });
});

describe("Trunk profile and studio", () => {
  it("opens the shared Remove confirmation from a non-default profile", async () => {
    const request = fake({ "sessions.list": { sessions: [] } });
    await mount(<TrunkProfile engine={engine(request)} agentId="birch" level="regular" onClose={() => {}} />);
    await click(byText("Remove Birch…"));
    expect(document.querySelector('[data-testid="trunk-remove"]')).toBeTruthy();
    await click(document.querySelector('[data-testid="trunk-remove"] .btn.bad'));
    expect(request).toHaveBeenCalledWith("agents.delete", { agentId: "birch" });
  });
  it("lists its automations from cron.list, toggles one, and shows the ID only at Technical", async () => {
    const request = fake({ "cron.list": { jobs: [{ id: "j1", name: "Morning", agentId: "birch", enabled: true, schedule: { kind: "every", everyMs: 1800000 } }] }, "sessions.list": { sessions: [] } });
    await mount(<TrunkProfile engine={engine(request)} agentId="birch" level="technical" onClose={() => {}} />);
    expect(request).toHaveBeenCalledWith("cron.list", { agentId: "birch", includeDisabled: true });
    expect(document.body.textContent).toContain("Every 30 min");
    expect(document.body.textContent).toContain("ID birch");
    await click(document.querySelector('[aria-label="Morning on or off"]'));
    expect(request).toHaveBeenCalledWith("cron.update", { id: "j1", patch: { enabled: false } });
    expect(byText("Pause Birch").disabled).toBe(true);
  });
  it("asks Branch through branch.chat and shows its reply", async () => {
    const request = vi.fn(() => Promise.resolve({ sessionId: "s", reply: "Here is my proposal.", action: "none", needsApproval: true }));
    await mount(<TrunkStudio engine={engine(request)} onClose={() => {}} />);
    expect(byText("Propose it").disabled).toBe(true);
    const box = document.querySelector("textarea")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Watch renewals"); box.dispatchEvent(new Event("input", { bubbles: true })); });
    await click(byText("Propose it"));
    expect(request).toHaveBeenCalledWith("branch.chat", expect.objectContaining({ welcomeVariant: "new-agent", message: "Make me a Trunk: Watch renewals" }));
    expect(document.body.textContent).toContain("Here is my proposal.");
    expect(byText("Make it")).toBeTruthy();
  });
});
