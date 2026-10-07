// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { useOperation, useResource, RequestGeneration } from "./data";
import { FileEditor, Tabs } from "./ui";
import { CustomizePlace } from "../customize";
import { PeoplePlace } from "../people";
import { createJob, JOBS } from "../customize/jobs-data";
vi.mock("../../face/Face", () => ({ Face: ({ label, size }: { label?: string; size: number }) => <span role="img" aria-label={label} data-face-size={size} /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let host: HTMLDivElement;
function mount(element: React.ReactNode) {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host); return act(async () => { root!.render(element); });
}
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; document.body.innerHTML = ""; });
function engine(request: ReturnType<typeof vi.fn>): WindowEngine { return { request: request as unknown as WindowEngine["request"], onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"] }; }
async function click(label: string) { const button = [...host.querySelectorAll("button")].find(b => b.textContent === label)!; expect(button, label).toBeTruthy(); await act(async () => { button.click(); }); }
async function edit(node: HTMLTextAreaElement | HTMLInputElement, value: string) {
  await act(async () => {
    const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
describe("place engine contracts", () => {
  it("refuses editing an existing file without a compare-and-save revision",async()=>{
    const request=vi.fn().mockResolvedValue({file:{name:"MEMORY.md",content:"stored"}});
    await mount(<FileEditor engine={engine(request)} agentId="main" name="MEMORY.md"/>);await edit(host.querySelector("textarea")!,"draft");
    expect([...host.querySelectorAll('button')].find(button=>button.textContent==="Save")!.disabled).toBe(true);
    expect(host.textContent).toContain("did not provide a document revision");expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not report Saved when a successful transport carries a refused write", async () => {
    const request = vi.fn((method: string) => Promise.resolve(method === "agents.files.get" ? { file: { name: "MEMORY.md", content: "old", hash: "abc" } } : { ok: false, error: "Revision conflict" }));
    await mount(<FileEditor engine={engine(request)} agentId="main" name="MEMORY.md" />);
    await edit(host.querySelector("textarea")!, "keep this draft");
    await click("Save");
    expect(host.textContent).toContain("Revision conflict");
    expect(host.textContent).not.toContain("Saved.");
    expect(host.querySelector("textarea")!.value).toBe("keep this draft");
    expect(request.mock.calls.filter(([method]) => method === "agents.files.set")).toHaveLength(1);
  });
  it("moves preview tabs by keyboard, wraps and keeps only the chosen tab in the tab order", async () => {
    function View() { const [tab, setTab] = useState("Memory"); return <Tabs values={["Memory", "Files", "Meetings"]} value={tab} onChange={setTab} label="Library" />; }
    await mount(<View />);
    const tabs = [...host.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    await act(async () => { tabs[0].focus(); tabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })); });
    expect(document.activeElement).toBe(tabs[2]);
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(tabs.map(tab => tab.tabIndex)).toEqual([-1, -1, 0]);
    await act(async () => tabs[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(document.activeElement).toBe(tabs[0]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  });
  it("retires a late generation after navigation", () => {
    const guard = new RequestGeneration(); const first = guard.next(); expect(first()).toBe(true);
    const second = guard.next(); expect(first()).toBe(false); expect(second()).toBe(true); guard.retire(); expect(second()).toBe(false);
  });
  it("keeps a new resource selection when the old request settles", async () => {
    let resolveOld!: (v: { label: string }) => void;
    const request = vi.fn((_: string, params: { id: string }) => params.id === "old" ? new Promise(r => { resolveOld = r; }) : Promise.resolve({ label: "new" }));
    const e = engine(request);
    function Panel({ id }: { id: string }) { const r = useResource<{ label: string }>(e, "agents.files.get", { id }); return <p>{r.data?.label}</p>; }
    await mount(<Panel id="old" />); await act(async () => root!.render(<Panel id="new" />));
    await act(async () => resolveOld({ label: "old" })); expect(host.textContent).toBe("new");
  });
  it("deduplicates repeated operations and surfaces a rejected engine write", async () => {
    let reject!: (e: Error) => void;
    const request = vi.fn(() => new Promise((_, no) => { reject = no; }));
    const e = engine(request); const done = vi.fn();
    function Panel() { const op = useOperation(e); return <><button onClick={() => { void op.run("skills.update", { skillKey: "search", enabled: true }, done); }}>Save</button><p>{op.error}</p></>; }
    await mount(<Panel />); await click("Save"); await click("Save"); expect(request).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error("permission denied"))); expect(host.textContent).toContain("permission denied"); expect(done).not.toHaveBeenCalled();
  });
  it("does not execute a receipt callback after leaving the screen", async () => {
    let resolve!: (v: unknown) => void;
    const request = vi.fn(() => new Promise(r => { resolve = r; })); const done = vi.fn();
    const e = engine(request);
    function Panel() { const op = useOperation(e); return <button onClick={() => { void op.run("agents.create", { name: "Oak" }, done); }}>Create</button>; }
    await mount(<Panel />); await click("Create"); await act(async () => root!.render(<p>Other place</p>));
    await act(async () => resolve({ ok: true })); expect(done).not.toHaveBeenCalled();
  });
  it("writes with the stored hash and keeps the draft when the server rejects a conflict", async () => {
    const request = vi.fn((method: string) => method === "agents.files.get" ? Promise.resolve({ file: { name: "MEMORY.md", content: "old", hash: "abc" } }) : Promise.reject(new Error("File changed")));
    await mount(<FileEditor engine={engine(request)} agentId="main" name="MEMORY.md" />);
    await edit(host.querySelector("textarea")!, "new memory"); await click("Save");
    expect(request).toHaveBeenCalledWith("agents.files.set", { agentId: "main", name: "MEMORY.md", content: "new memory", expectedHash: "abc" });
    expect(host.querySelector("textarea")!.value).toBe("new memory"); expect(host.textContent).toContain("File changed"); expect(host.textContent).not.toContain("Saved.");
  });
  it("lists real profiles and preserves empty-state truth after a read error", async () => {
    const request = vi.fn(() => Promise.reject(new Error("Disconnected")));
    await mount(<PeoplePlace engine={engine(request)} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} level="regular" />);
    expect(request).toHaveBeenCalledWith("users.list", {}); expect(host.textContent).toContain("Disconnected"); expect(host.textContent).not.toContain("No people registered");
  });
});

describe("preview topology and supported followup operations", () => {
  it("matches the canonical Customize tabs and uses actual Trunk faces and job cards", async () => {
    const request = vi.fn(() => Promise.resolve({ defaultId: "main", mainKey: "main", agents: [{ id: "main", name: "Sapling", identity: { theme: "General help" } }] }));
    await mount(<CustomizePlace engine={engine(request)} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} level="regular" />);
    expect([...host.querySelectorAll('[aria-label="Customize"] [role="tab"]')].map(t => t.textContent)).toEqual(["Trunks", "Tools", "Specialists", "Chat apps", "Everywhere"]);
    expect(host.querySelector('[aria-label="Sapling"]')?.getAttribute("data-face-size")).toBe("36");
    expect(host.querySelectorAll('[aria-label^="Use this job:"]')).toHaveLength(6);
  });
  it("creates a real job Trunk and preserves the source instructions with version checks", async () => {
    const request = vi.fn((method: string) => Promise.resolve(method === "agents.create" ? { ok: true, agentId: "research" } : method === "agents.list" ? { agents: [{ id: "research" }] } : method === "agents.files.get" ? { file: { content: "Source defaults", hash: "original" } } : { ok: true }));
    await createJob(engine(request), JOBS[2]);
    expect(request).toHaveBeenCalledWith("agents.create", { name: "Researcher" });
    expect(request).toHaveBeenCalledWith("agents.files.set", { agentId: "research", name: "SOUL.md", expectedHash: "original", content: "Source defaults\n\n## Your job\n\nReads the web and writes short briefs with sources.\n" });
  });
  it("reports partial job creation and does not overwrite an unversioned instruction file", async () => {
    const request = vi.fn((method: string) => Promise.resolve(method === "agents.create" ? { ok: true, agentId: "research" } : method === "agents.list" ? { agents: [{ id: "research" }] } : { file: { content: "Source defaults" } }));
    await expect(createJob(engine(request), JOBS[2])).rejects.toThrow("was created (research), but its job instructions were not saved");
    expect(request.mock.calls.some(([method]) => method === "agents.files.set")).toBe(false);
  });
  it("reads members only for a selected actually shared conversation", async () => {
    const request = vi.fn((method: string) => Promise.resolve(method === "users.list" ? { profiles: [] } : method === "system-presence" ? [] : method === "session.members.list" ? { members: [{ identityId: "ada" }], identities: [{ id: "ada", displayName: "Ada Person" }] } : { sessions: [{ key: "agent:main:private", visibility: "draft", label: "Private" }, { key: "agent:main:shared", visibility: "shared", label: "Shared work" }] }));
    await mount(<PeoplePlace engine={engine(request)} facts={{ running: 0, waiting: 0 }} openConversation={() => {}} openPlace={() => {}} level="regular" />);
    await click("Shared"); expect(host.textContent).toContain("Shared work"); expect(host.textContent).not.toContain("Private");
    const button = host.querySelector('.kp-row button') as HTMLButtonElement;
    await act(async () => button.click());
    expect(request).toHaveBeenCalledWith("session.members.list", { sessionKey: "agent:main:shared" }); expect(host.textContent).toContain("Ada Person");
  });
});
