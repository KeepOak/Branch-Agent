// @vitest-environment jsdom
// Each settings loader that can sit on "loading" must say so after STALL_MS and run the read again from Try again.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { LibraryPlace } from "../library";
import { KitProvider, type SaveReport } from "./kit";
import { STALL_MS, STALL_TEXT } from "./stall";
import { CodingApps } from "./set1/coding-apps";
import { LocalPage } from "./set1/local";
import { OwnAccounts } from "./set1/own-accounts";
import { BROWSER_MORE } from "./set2/computer-browser";
import { ComputerMore, type Ctx } from "./set2/computer-more";
import { UsagePage } from "./set2/usage";
import { OwnAccountList } from "../../screens/settings/pages/accounts-live";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let hold: boolean;
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };

beforeEach(() => {
  vi.useFakeTimers();
  hold = true;
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; }, onchange: null, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
  host = document.body.appendChild(document.createElement("div"));
  host.className = "set-col";
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

type Answers = Record<string, unknown | ((params: Record<string, unknown>) => unknown)>;
function engineFor(answers: Answers, hung: (method: string, params: Record<string, unknown>) => boolean) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    if (hold && hung(method, params)) return new Promise(() => undefined);
    const answer = answers[method];
    if (answer instanceof Error) throw answer;
    return typeof answer === "function" ? answer(params) : answer ?? {};
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: ["operator.admin"] } as unknown as WindowEngine;
  return { engine, request };
}
async function flush() {
  await act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
}
async function passDeadline() {
  await act(async () => { await vi.advanceTimersByTimeAsync(STALL_MS); });
  await flush();
}
function button(text: string, scope: ParentNode = host) {
  return [...scope.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) ?? null;
}
async function click(el: Element | null) {
  expect(el).toBeTruthy();
  await act(async () => { (el as HTMLElement).click(); });
  await flush();
}
const sec = (title: string) => host.querySelector(`[data-sec="${title}"]`);
const dialog = (label: string) => document.querySelector(`[role="dialog"][aria-label="${label}"]`);

const CONFIG = { hash: "h", valid: true, config: {} };
const kit = (node: ReactNode) => <KitProvider level={1} report={report} scope={null}>{node}</KitProvider>;

describe("settings loaders that never answer", () => {
  it("stops Coding apps on the deadline and checks again from Check again", async () => {
    const { engine, request } = engineFor(
      { "config.get": CONFIG, "usage.status": { providers: [] }, "branch.setup.detect": { candidates: [{ kind: "codex-cli", credentials: true }], unavailableCandidates: [] } },
      (method) => method === "branch.setup.detect",
    );
    await act(async () => { root.render(kit(<CodingApps engine={engine} />)); });
    await flush();
    const apps = sec("Coding apps on this computer")!;
    expect(apps.textContent).toContain("Looking on this computer…");
    await passDeadline();
    expect(apps.textContent).toContain(STALL_TEXT);
    expect(apps.textContent).not.toContain("Looking on this computer…");
    const before = request.mock.calls.filter(([method]) => method === "branch.setup.detect").length;
    hold = false;
    await click(button("Check again", apps));
    expect(request.mock.calls.filter(([method]) => method === "branch.setup.detect").length).toBeGreaterThan(before);
    expect(apps.textContent).toContain("Models ready");
  });

  it("stops Local runtimes on the deadline and looks again from Try again", async () => {
    const detect = { candidates: [{ kind: "provider-auto:ollama", brandId: "ollama", modelRef: "ollama/m" }], unavailableCandidates: [], prepareOptions: [] };
    const { engine, request } = engineFor(
      { "config.get": CONFIG, "system.info": { platform: "linux", memoryTotalBytes: 8 * 1024 ** 3, diskAvailableBytes: 1024 ** 3 }, "branch.setup.detect": detect, "models.list": { models: [] } },
      (method) => method === "branch.setup.detect" || method === "models.list",
    );
    await act(async () => { root.render(kit(<LocalPage page="local" title="On this computer" level="regular" engine={engine} />)); });
    await flush();
    const runtimes = sec("Runtimes")!;
    expect(runtimes.textContent).toContain("Looking…");
    await passDeadline();
    expect(runtimes.textContent).toContain(STALL_TEXT);
    expect(button("Try again", runtimes)).toBeTruthy();
    expect(runtimes.textContent).not.toContain("Looking…");
    hold = false;
    await click(button("Try again", runtimes));
    expect(request.mock.calls.filter(([method]) => method === "branch.setup.detect").length).toBeGreaterThan(1);
    expect(runtimes.textContent).toContain("Found");
  });

  it("stops Devices on the deadline and reads this computer again from Try again", async () => {
    const detect = { candidates: [], unavailableCandidates: [], prepareOptions: [{ id: "llama-cpp", label: "Managed local server", actionLabel: "Set it up" }] };
    const { engine, request } = engineFor(
      { "config.get": CONFIG, "system.info": { platform: "linux" }, "branch.setup.detect": detect, "models.list": { models: [] } },
      (method) => method === "branch.setup.detect" || method === "models.list",
    );
    await act(async () => { root.render(kit(<LocalPage page="local" title="On this computer" level="regular" engine={engine} />)); });
    await flush();
    const recommended = sec("Recommended for you")!;
    expect(recommended.textContent).toContain("Looking for what this computer can run…");
    await passDeadline();
    expect(recommended.textContent).toContain(STALL_TEXT);
    expect(recommended.textContent).not.toContain("Looking for what this computer can run…");
    const before = request.mock.calls.filter(([method]) => method === "branch.setup.detect" || method === "models.list").length;
    hold = false;
    await click(button("Try again", recommended));
    expect(request.mock.calls.filter(([method]) => method === "branch.setup.detect" || method === "models.list").length).toBeGreaterThan(before);
    expect(recommended.textContent).toContain("Managed local server");
  });

  it("stops Memory on the deadline and reads the files again from Try again", async () => {
    const { engine, request } = engineFor({
      "agents.list": { defaultId: "a", agents: [{ id: "a", identity: { name: "Main" } }] },
      "agents.files.get": (params: Record<string, unknown>) => params.name === "MEMORY.md"
        ? { file: { name: "MEMORY.md", path: "MEMORY.md", content: "- Prefers an aisle seat.\n", missing: false } }
        : { file: { name: "USER.md", missing: true } },
      "doctor.memory.status": { provider: "builtin", embedding: { ok: true, checked: true } },
      "config.get": { config: { agents: { defaults: { bootstrapMaxChars: 12000 } } }, hash: "c" },
      "agents.workspace.list": { entries: [] },
    }, (method, params) => method === "agents.files.get" && params.name === "MEMORY.md");
    await act(async () => {
      root.render(<LibraryPlace engine={engine} level="regular" facts={{ running: 0, waiting: 0 }} openConversation={() => undefined} openPlace={() => undefined} openSettings={() => undefined} />);
    });
    await flush();
    const card = () => host.querySelector(".lib-card")!;
    expect(card().textContent).toContain("Loading…");
    await passDeadline();
    expect(card().textContent).toContain(STALL_TEXT);
    expect(button("Try again", card())).toBeTruthy();
    expect(card().textContent).not.toContain("Loading…");
    const before = request.mock.calls.filter(([method]) => method === "agents.files.get").length;
    hold = false;
    await click(button("Try again", card()));
    expect(request.mock.calls.filter(([method]) => method === "agents.files.get").length).toBeGreaterThan(before);
    expect(card().textContent).toContain("1 memory");
  });

  it("stops Your own accounts on the deadline and reads them again from Try again", async () => {
    const accounts = { profileId: "me", accounts: [{ authProfileId: "openai:work", provider: "openai", label: "Work", selected: true }] };
    const { engine, request } = engineFor({ "users.listModelAccounts": accounts }, (method) => method === "users.listModelAccounts");
    await act(async () => { root.render(<><OwnAccountList engine={engine} row={{ id: "accounts.own.list", page: "accounts", card: "Your own accounts", label: "Your own accounts", level: 0, ownerLevel: true, control: "custom", source: { kind: "slot", calls: [], reason: "Drawn by the page." } }} /><OwnAccounts engine={engine} /></>); });
    await flush();
    expect(host.textContent).toContain("Reading your accounts…");
    await passDeadline();
    expect(host.textContent).toContain(STALL_TEXT);
    expect([...host.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Try again")).toHaveLength(2);
    expect(host.textContent).not.toContain("Reading your accounts…");
    const before = request.mock.calls.filter(([method]) => method === "users.listModelAccounts").length;
    hold = false;
    await click(button("Try again"));
    await click(button("Try again"));
    expect(request.mock.calls.filter(([method]) => method === "users.listModelAccounts").length).toBeGreaterThan(before);
    expect(host.textContent).toContain("Work");
  });

  it("stops Check what works on the deadline and checks again from Try again", async () => {
    const { engine, request } = engineFor(
      { "config.get": CONFIG, "computer.status": { available: true, computerUse: { provider: { label: "Screen" }, screen: true } } },
      (method) => method === "computer.status",
    );
    await act(async () => { root.render(kit(<ComputerMore page="computer" title="Computer & browser" level="regular" engine={engine} part="browser" />)); });
    await flush();
    await click(button("Check", sec("Using the screen")!));
    const box = () => dialog("Check what works")!;
    expect(box().textContent).toContain("Checking…");
    await passDeadline();
    expect(box().textContent).toContain(STALL_TEXT);
    expect(button("Try again", box())).toBeTruthy();
    expect(box().textContent).not.toContain("Checking…");
    const before = request.mock.calls.filter(([method]) => method === "computer.status").length;
    hold = false;
    await click(button("Try again", box()));
    expect(request.mock.calls.filter(([method]) => method === "computer.status").length).toBeGreaterThan(before);
    expect(box().textContent).toContain("Computer control works through Screen");
  });

  it("stops Usage counting on the deadline and counts again from Try again", async () => {
    const usage = { startDate: "2026-10-01", endDate: "2026-10-03", totals: { totalCost: 2 }, aggregates: { messages: { user: 1 }, byModel: [{ model: "gpt-5", totals: { totalCost: 2 } }] }, sessions: [] };
    const { engine } = engineFor({ "sessions.usage": usage, "config.get": CONFIG, "agents.list": { agents: [] } }, (method) => method === "sessions.usage");
    await act(async () => { root.render(<UsagePage page="usage" title="Data & usage" level="regular" engine={engine} />); });
    await flush();
    await click(button("Open the report"));
    const box = () => dialog("Usage · last 30 days")!;
    expect(box().textContent).toContain("Counting…");
    await passDeadline();
    expect(box().textContent).toContain(STALL_TEXT);
    expect(button("Try again", box())).toBeTruthy();
    expect(box().textContent).not.toContain("Counting…");
    hold = false;
    await click(button("Try again", box()));
    expect(box().textContent).toContain("By model");
    expect(box().textContent).not.toContain("Counting…");
  });

  it("stops Browser profiles on the deadline and reads them again from Try again", async () => {
    const { engine, request } = engineFor(
      { "config.get": CONFIG, "browser.request": { profiles: [{ name: "work", driver: "branch", running: false }] } },
      (method, params) => method === "browser.request" && params.path === "/profiles",
    );
    const row = BROWSER_MORE[0].rows!.find((item) => item.t === "Browser profiles")!;
    const ctx = { engine, lv: 1, props: { page: "computer", title: "Computer", level: "advanced", engine } } as Ctx;
    await act(async () => { root.render(kit(row.render!(ctx))); });
    await flush();
    await click(button("Manage"));
    const box = () => dialog("Browser profiles")!;
    expect(box().textContent).toContain("Reading the profiles…");
    await passDeadline();
    expect(box().textContent).toContain(STALL_TEXT);
    expect(button("Try again", box())).toBeTruthy();
    expect(box().textContent).not.toContain("Reading the profiles…");
    const before = request.mock.calls.filter(([method]) => method === "browser.request").length;
    hold = false;
    await click(button("Try again", box()));
    expect(request.mock.calls.filter(([method]) => method === "browser.request").length).toBeGreaterThan(before);
    expect(box().textContent).toContain("work");
  });
});
