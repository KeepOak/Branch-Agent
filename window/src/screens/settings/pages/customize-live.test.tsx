// @vitest-environment jsdom
// Settings › Customize is a native R1 page (#1049, section D blockers 1 and 2): it never hands the window to Classic
// Settings or Classic Advanced, and it draws the approved preview's cards in the preview's order at each level
// (preview.html PG czP17 and graftsT5, rendered at Regular, Advanced and Technical), with the preview's row words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { forgetLookStore } from "../../../places/settings/set1/appearance-store";
import { CLASSIC_PAGE, r1SettingsPage } from "../../frame/R1Window";
import { PAGES } from "../nav";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

const AGENTS = { enabled: true, agents: [
  { id: "claude-code-a1b2c3", name: "Claude Code", where: "This computer", online: true, lastSeenAt: 1, revoked: false, mayDriveWindow: true },
  { id: "codex-d4e5f6", name: "Codex", online: false, lastSeenAt: 1, revoked: false, mayDriveWindow: false },
] };
function engineOf(extra: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string) => {
    if (method in extra) return extra[method];
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.patch") return { ok: true };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "agents.list") return { agents: [{ id: "main", identity: { name: "Sapling" } }], defaultId: "main", mainKey: "agent:main:main" };
    if (method === "contacts.outside.list") return AGENTS;
    if (method === "skills.library.list") return { entries: [{ skillId: "s1", slug: "brief", description: "Write a one-page brief on {{topic}} with numbered sources." }] };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"] } as unknown as WindowEngine, request };
}
async function mount(engine: WindowEngine, level: "regular" | "advanced" | "technical", onAsk?: (text: string) => void) {
  localStorage.setItem("branch.level", level);
  await act(async () => root.render(<SettingsFrame engine={engine} page="customize" pages={R1_PAGES} onAsk={onAsk} />));
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const cards = () => [...host.querySelectorAll<HTMLElement>(".r1s-sec")].map((s) => s.querySelector(":scope > h2")?.textContent ?? "");
const labels = (card: string) => [...host.querySelectorAll<HTMLElement>(`.r1s-sec[aria-label="${card}"] .r1s-row > b`)].map((b) => b.textContent);

it("is an R1 Settings page, never Classic Advanced", () => {
  expect(r1SettingsPage("customize", R1_PAGES)).toBe(true);
  expect(CLASSIC_PAGE.customize).toBeUndefined();
  expect(PAGES.customize.cards).toEqual(["", "Saved prompts", "Tools and skills", "Skills", "Plugins", "Helpers and other agents", "What it can do", "Allow", "Connected agents", "Connect an agent", "Another Branch"]);
});

it("draws the preview's Customize cards in order at each level", async () => {
  const { engine } = engineOf();
  await mount(engine, "regular");
  expect(cards()).toEqual(["", "Allow", "Connected agents", "Connect an agent", "Another Branch"]);
  expect(host.querySelector("[data-testid=customize-hub]")).not.toBeNull();
  await act(async () => root.unmount()); root = createRoot(host); forgetLookStore();
  await mount(engine, "advanced");
  expect(cards()).toEqual(["", "Saved prompts", "Tools and skills", "Skills", "Helpers and other agents", "What it can do", "Allow", "Connected agents", "Connect an agent", "Another Branch"]);
  await act(async () => root.unmount()); root = createRoot(host); forgetLookStore();
  await mount(engine, "technical");
  expect(cards()).toEqual(["", "Saved prompts", "Tools and skills", "Skills", "Plugins", "Helpers and other agents", "What it can do", "Allow", "Connected agents", "Connect an agent", "Another Branch"]);
});

it("draws the kinds hub in the preview's order and words, with For:", async () => {
  await mount(engineOf().engine, "regular");
  const hub = host.querySelector<HTMLElement>("[data-testid=customize-hub]")!;
  expect(hub.querySelector(".cz-lh")?.textContent).toBe("For:");
  expect([...hub.querySelectorAll(".cz-whose .cz-chip")].map((b) => b.textContent)).toEqual(["All", "Sapling"]);
  expect([...hub.querySelectorAll(".t9-kind b")].map((b) => b.textContent)).toEqual(["Toolsets", "Connectors", "Skills", "Plugins", "Command-line tools", "Agents & specialists"]);
  expect(hub.textContent).toContain("2 agents connected · 1 online");
});

it("uses the preview's row words in each card", async () => {
  await mount(engineOf().engine, "technical");
  expect(labels("Customize")).toEqual(["Pinned skills", "Signed packages only", "Search back end"]);
  // Working rows stay in preview order. Later-update rows fold after them (LaterRows), still in their own order.
  expect(labels("Tools and skills")).toEqual(["Search the web", "Web search", "Web search details", "Search X", "Let plugins add their own views", "Connector app views",
    "Your own tools from files", "Find tools with a command", "Run connector programs on Branch’s own Node.js", "Python service", "Check a skill is ready first",
    "Only signed skill packages", "Check install requests for malware", "Video tools"]);
  expect(labels("Skills")).toEqual(["Extra skill folders", "Built-in skills to offer", "Pick up skill changes by themselves", "Install skills with", "Every skill setting",
    "Start a skill by itself when it clearly fits", "Run !`command` lines in skills", "Where new skills are saved", "Always read in full"]);
  expect(labels("Plugins")).toEqual(["Load plugins", "Only these plugins", "Never these plugins", "Extra plugin folders", "Memory engine", "Context engine"]);
  expect(labels("Helpers and other agents")).toEqual(["Helpers’ model", "Trunks message each other", "Take work over the agent protocol", "Look after several assistants at once", "Helpers at once",
    "Helpers get the connectors", "New helpers start with", "Helpers use", "Ask a stronger model on hard calls", "Plan first on long tasks",
    "Wait for my yes on the plan", "Check the answer before saying done", "Who may call your Trunks from outside", "Tools lent by a connected program",
    "Carry a conversation on somewhere else", "Other computers running Branch, side by side", "Trunks on other computers", "When every helper slot is busy", "Waiting line", "Wait at most"]);
  expect(labels("What it can do")).toEqual(["Read links you paste", "Deep research reports", "Edit documents exactly", "Tables and charts from spreadsheets", "GitLab", "Smart home", "Numbered sources you can check"]);
  expect(labels("Allow")).toEqual(["Let agents connect", "Let agents use this window"]);
  expect(labels("Connect an agent")[0]).toBe("Type branch in any terminal");
  expect(labels("Another Branch")).toEqual(["Pair with Branch on another computer"]);
});

it("keeps every working Classic Connected agents control: the switch, each agent's rights and Revoke", async () => {
  const { engine, request } = engineOf();
  await mount(engine, "regular");
  const agents = [...host.querySelectorAll<HTMLElement>("[data-testid=connected-agent]")];
  expect(agents.map((a) => a.dataset.agent)).toEqual(["claude-code-a1b2c3", "codex-d4e5f6"]);
  expect(agents[0].textContent).toContain("May talk to Sapling · may use this window");
  await act(async () => { [...agents[0].querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Permissions")!.click(); });
  expect(agents[0].textContent).toContain("May message Sapling");
  const off = host.querySelector<HTMLButtonElement>('[data-row="customize.allow.connect"] [role=switch]')!;
  expect(off.getAttribute("aria-checked")).toBe("true");
  await act(async () => { off.click(); await new Promise((r) => setTimeout(r, 0)); });
  expect(request).toHaveBeenCalledWith("contacts.outside.set", { enabled: false });
  const revoke = [...agents[1].querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Revoke")!;
  await act(async () => { revoke.click(); await new Promise((r) => setTimeout(r, 0)); });
  expect(request).toHaveBeenCalledWith("contacts.outside.set", { id: "codex-d4e5f6", revoked: true });
});

it("lists saved prompts with Try it, sent to the default Trunk", async () => {
  const onAsk = vi.fn();
  await mount(engineOf().engine, "advanced", onAsk);
  const card = host.querySelector<HTMLElement>('.r1s-sec[aria-label="Saved prompts"]')!;
  expect(card.textContent).toContain("/brief");
  await act(async () => { [...card.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Try it")!.click(); });
  expect(onAsk).toHaveBeenCalledWith("/brief");
});
