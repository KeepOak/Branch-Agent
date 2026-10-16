// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CapabilityProvider } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { undeclaredControls } from "../../glass/coming-registry";
import type { Block } from "../../thread/model";
import { entriesOf } from "./chat-logic";
import { ChatView, type ChatViewProps } from "./ChatView";
import { layout } from "../../thread/layout";
import { FIND_EVENT } from "../../thread/FindBar";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label: string }) => <span data-face={label} /> }));
vi.mock("../../composer/useConversation", () => ({ useConversation: () => ({ loaded: false }), hasNoModel: () => true }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.unstubAllGlobals(); });

const engineWith = (methods: string[]): WindowEngine => ({ request: vi.fn(async () => ({})), onEvent: () => () => undefined, sessionKey: "agent:scout:main", agentId: "scout", scopes: ["operator.admin"], features: { methods, events: [] } }) as WindowEngine;
const t0 = new Date(2026, 9, 12, 12, 2).getTime();
const history: Block[] = [
  { kind: "user", key: "u1", text: "Find the Hartwell invoice from August.", meta: { entryId: "e1", timestamp: t0 } },
  { kind: "thinking", key: "th1", text: "It is probably still in Outlook, not in Downloads.", live: false },
  { kind: "step", key: "s1", outputKey: "r1:s1", tool: "read", title: "Downloads", detail: "", status: "ok", at: t0 + 10_000 },
  { kind: "step", key: "s2", outputKey: "r1:s2", tool: "exec", title: "ls ~/Documents", detail: "Exit 1", status: "failed", at: t0 + 20_000 },
  { kind: "text", key: "a1", text: "On it. It isn’t in **Downloads**.", streaming: false, meta: { entryId: "e2", timestamp: t0 + 30_000, model: "openai/gpt-6.1-sol" } },
  { kind: "done", key: "r1:done", runId: "r1", durationMs: 48_000 },
];
async function show(props: Partial<ChatViewProps>, methods?: string[]) {
  const engine = methods ? engineWith(methods) : undefined;
  const view = <ChatView name="Scout" history={[]} live={[]} pendingUser={null} running={false} onAnswer={() => undefined} engine={engine} sessionKey={engine?.sessionKey} {...props} />;
  await act(async () => root.render(methods ? <CapabilityProvider engine={engine!}>{view}</CapabilityProvider> : view));
}

it("renders an empty conversation, with and without an engine, without demo data", async () => {
  await show({});
  expect(host.querySelector('[data-testid="empty-chat"]')!.textContent).toContain("What should Scout do?");
  await show({}, []);
  expect(host.querySelectorAll('[data-testid="message"]')).toHaveLength(0);
  await show({ historyReady: false });
  expect(host.querySelector('[data-testid="opening"]')).not.toBeNull();
});

it("draws your bubble, the reply, one time divider, the calm steps and a 3-button bar per message", async () => {
  await show({ history }, ["chat.send", "session.reactions.set"]);
  expect(host.querySelector('.r1c-u')!.textContent).toContain("Find the Hartwell invoice");
  expect(host.querySelector('[data-role="assistant"] strong')!.textContent).toBe("Downloads");
  expect(host.querySelectorAll('[data-testid="time-divider"]')).toHaveLength(1);
  const steps = host.querySelectorAll('[data-testid="steps"]');
  expect(steps).toHaveLength(1);
  expect(steps[0].querySelector("summary")!.textContent).toContain("1 failed");
  expect(host.querySelectorAll('[data-testid="hover-bar"]')).toHaveLength(2);
  for (const bar of host.querySelectorAll('[data-testid="hover-bar"]')) expect(bar.querySelectorAll(":scope > button")).toHaveLength(3);
  // Normal: the thought stays out of sight; it never becomes prose.
  expect(host.textContent).not.toContain("probably still in Outlook");
});

it("adds a divider after 15 quiet minutes and keeps thoughts inside the steps", async () => {
  const later: Block[] = [...history, { kind: "user", key: "u2", text: "And July?", meta: { entryId: "e3", timestamp: t0 + 20 * 60_000 } }];
  await show({ history: later });
  expect(host.querySelectorAll('[data-testid="time-divider"]')).toHaveLength(2);
  const entries = entriesOf(layout(history));
  const steps = entries.find((e) => e.type === "steps");
  expect(steps && steps.type === "steps" ? steps.thoughts.map((t) => t.key) : []).toEqual(["th1"]);
});

it("keeps one working line above the reply while it streams in word by word", async () => {
  await show({ history: history.slice(0, 1), running: true, live: [] });
  expect(host.querySelector('[data-testid="working-line"]')!.textContent).toMatch(/^Working…/);
  await show({ history: history.slice(0, 1), running: true, live: [{ kind: "text", key: "r2:text:1", text: "Looking in Outlook now", streaming: true }] });
  const line = host.querySelector('[data-testid="working-line"]')!;
  expect(line.textContent).toMatch(/^Working…/);
  const reply = host.querySelector('[data-role="assistant"]')!;
  expect(line.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const words = [...host.querySelectorAll('[data-testid="streaming"] .r1c-tok')];
  expect(words.map((w) => w.textContent).join("")).toBe("Looking in Outlook now");
  const first = words[0];
  await show({ history: history.slice(0, 1), running: true, live: [{ kind: "text", key: "r2:text:1", text: "Looking in Outlook now for it", streaming: true }] });
  expect(host.querySelector('[data-testid="streaming"] .r1c-tok')).toBe(first);
});

it("shows the live run's token count from the engine's usage block, as Classic did", async () => {
  const text: Block = { kind: "text", key: "r2:text:1", text: "Looking in Outlook now", streaming: true };
  const usage: Block = { kind: "usage", key: "r2:usage", input: 1000, output: 234, total: 1234 };
  await show({ history: history.slice(0, 1), running: true, live: [text, usage] });
  expect(host.querySelector('[data-testid="live-usage"]')!.textContent).toContain((1234).toLocaleString() + " tokens so far");
  await show({ history: history.slice(0, 1), running: true, live: [usage] });
  expect(host.querySelector('[data-testid="live-usage"]')).toBeNull();
  await show({ history: history.slice(0, 1), running: false, live: [text, usage] });
  expect(host.querySelector('[data-testid="live-usage"]')).toBeNull();
});

it("puts a run error in a thin notice with its details, never in the reply's prose", async () => {
  await show({ history: [...history.slice(0, 1), { kind: "error", key: "r1:error", runId: "r1", message: "Model quota exceeded. Retry after 2 minutes. stack: x" }] });
  const notice = host.querySelector('[data-testid="run-error"]')!;
  expect(notice.getAttribute("role")).toBe("alert");
  expect(notice.textContent).toContain("Scout couldn’t finish: Model quota exceeded.");
  expect(host.querySelector('[data-role="assistant"]')).toBeNull();
});

it("says when the conversation couldn't load and reads it again on Try again", async () => {
  const onReload = vi.fn();
  await show({ loadError: "chat.history failed", onReload }, ["chat.history"]);
  const notice = host.querySelector('[data-testid="load-error"]')!;
  expect(notice.textContent).toContain("Couldn’t load this conversation");
  await act(async () => [...notice.querySelectorAll("button")].find((b) => b.textContent === "Try again")!.click());
  expect(onReload).toHaveBeenCalledOnce();
});

it("every control is wired to the engine or shows Coming, even with no methods at all", async () => {
  const left: Block[] = history.map((b) => (b.key === "u1" && b.kind === "user" ? { ...b, meta: { ...b.meta, excluded: true } } : b));
  await show({ history: left, onReply: () => undefined, onStart: () => undefined, loadError: "chat.history failed", onReload: () => undefined }, []);
  const undeclared = () => undeclaredControls(document).map((el) => el.getAttribute("aria-label") ?? el.textContent);
  expect(undeclared()).toEqual([]);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="React"]')!.getAttribute("aria-disabled")).toBe("true");
  const coming = (el: Element | undefined) => [el?.getAttribute("aria-disabled"), Boolean((el as HTMLElement | undefined)?.dataset.coming), el?.hasAttribute("data-local")];
  const putBack = [...host.querySelectorAll(".r1c-out-line button")].find((b) => b.textContent === "Put back");
  expect(coming(putBack)).toEqual(["true", true, false]);
  const again = [...host.querySelectorAll('[data-testid="load-error"] button')].find((b) => b.textContent === "Try again");
  expect(coming(again)).toEqual(["true", true, false]);
  // The reply's ••• menu: rows that call the engine are Coming, only Copy and Look inside stay local.
  const bars = host.querySelectorAll('[data-testid="hover-bar"]');
  await act(async () => bars[bars.length - 1].querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
  const rows = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
  const row = (label: string) => rows.find((b) => b.textContent === label);
  for (const label of ["Reply", "Retry", "Read aloud", "Leave out of context"]) expect(coming(row(label)), label).toEqual(["true", true, false]);
  expect(rows.filter((b) => !b.dataset.coming).map((b) => b.textContent)).toEqual(["Copy›", "Look inside"]);
  expect(undeclared()).toEqual([]);
  // Your own message: Edit, Branch from here and Put back in context are Coming too.
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await act(async () => bars[0].querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
  const mine = [...document.querySelectorAll<HTMLElement>('[role="menu"][aria-label="Message"] [role="menuitem"]')];
  for (const label of ["Reply", "Edit", "Branch from here", "Put back in context"]) expect(coming(mine.find((b) => b.textContent === label)), label).toEqual(["true", true, false]);
  expect(undeclared()).toEqual([]);
});

it("follows the item 48 glass model: clear conversation and menus, text and controls on frosted pills, solid with Reduce transparency", () => {
  const css = readFileSync("src/screens/chat/chat.css", "utf8").replace(/\s+/g, " ");
  const tokens = readFileSync("src/theme/tokens.css", "utf8").replace(/\s+/g, " ");
  expect(tokens).toContain("--gp-fill: rgba(255,255,255,.76); --gp-edge: rgba(0,0,0,.11);");
  expect(tokens).toMatch(/:root\[data-transparency="reduce"\][^{]*\{ --gp-fill: var\(--raise\);[^}]*--gp-blur: none; \}/);
  for (const piece of [".r1c-u", ".r1c-txt", ".r1c-notice", ".r1c-steps > summary", ".r1c-chip", ".r1c-bar", ".r1c-mi", ".r1c-menu-meta"]) {
    expect(css, piece).toMatch(new RegExp(":is\\([^)]*" + piece.replace(/[.>]/g, (c) => "\\" + c) + "[,)]"));
  }
  expect(css).toContain("background: var(--gp-fill); backdrop-filter: var(--gp-blur); -webkit-backdrop-filter: var(--gp-blur); box-shadow: inset 0 0 0 1px var(--gp-edge);");
  expect(css).toContain(".g-popover:has(> .r1c-menu, > .r1c-react) { background: transparent; backdrop-filter: none;");
});

it("Regular: a live run is one line, the steps disclosure, with the current step in plain words", async () => {
  const live: Block[] = [{ kind: "step", key: "l1", outputKey: "r2:l1", tool: "mcp__plugin_github_github__list_pull_requests", title: "KeepOak/Branch-Agent", detail: "", status: "running", at: Date.now() - 12_000 }];
  await show({ history: history.slice(0, 1), live, running: true }, ["chat.send"]);
  expect(host.querySelector('[data-testid="working-line"]')).toBeNull();
  const disclosure = host.querySelector('[data-testid="steps"] .r1c-steps-text')!;
  expect(disclosure.textContent).toMatch(/^Working… Using list pull requests · \d+s$/);
  expect(disclosure.classList.contains("r1c-shimmer")).toBe(true);
  expect(host.textContent).not.toContain("so far");
  expect(host.textContent).not.toContain("mcp__");
  expect(host.querySelectorAll('[data-testid="steps"]')).toHaveLength(1);
  const fold = host.querySelector<HTMLDetailsElement>('[data-testid="steps"]')!;
  expect(fold.open).toBe(false);
  await act(async () => fold.querySelector("summary")!.click());
  expect(host.querySelector(".r1c-step-sub")).toBeNull();
  expect(host.querySelector(".r1c-step-title")!.textContent).toBe("Using list pull requests");
  await show({ history }, ["chat.send"]);
  expect(host.querySelector('[data-testid="working-line"]')).toBeNull();
  expect(host.querySelector('[data-testid="steps"] .r1c-steps-text')!.textContent).toBe("Worked for 48s · 2 steps");
});

it("Advanced and Technical: the live row keeps the step detail, and the working line sits in the message column", async () => {
  localStorage.setItem("branch.level", "advanced");
  const live: Block[] = [{ kind: "step", key: "l1", outputKey: "r2:l1", tool: "mcp__plugin_github_github__list_pull_requests", title: "KeepOak/Branch-Agent", detail: "", status: "running", at: t0 + 40_000 }];
  await show({ history: history.slice(0, 1), live, running: true }, ["chat.send"]);
  expect(host.querySelector('[data-testid="steps"] .r1c-steps-text')!.textContent).toBe("Working in GitHub · 1 step so far");
  const line = host.querySelector('[data-testid="working-line"]')!;
  expect(line.textContent).toBe("Working in GitHub");
  expect(line.closest(".r1c-body")).not.toBeNull();
  const fold = host.querySelector<HTMLDetailsElement>('[data-testid="steps"]')!;
  if (!fold.open) await act(async () => fold.querySelector("summary")!.click());
  expect(host.querySelector(".r1c-step-sub")!.textContent).toBe(" · KeepOak/Branch-Agent");
  localStorage.setItem("branch.level", "technical");
  await act(async () => { window.dispatchEvent(new StorageEvent("storage", { key: "branch.level" })); });
  expect(host.querySelector(".r1c-step-sub")!.textContent).toBe(" · KeepOak/Branch-Agent");
  localStorage.removeItem("branch.level");
});

it("opens find in this conversation with the words a search result asked for", async () => {
  await show({ history }, ["chat.send"]);
  expect(host.querySelector(".find-bar")).toBeNull();
  await act(async () => { window.dispatchEvent(new CustomEvent(FIND_EVENT, { detail: { query: "Hartwell" } })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  expect(host.querySelector<HTMLInputElement>(".find-bar input")?.value).toBe("Hartwell");
});

it("offers Edit only on your own last message, Retry on a reply, and Show what it did only at Technical", async () => {
  const methods = ["chat.send", "sessions.rewind", "session.reactions.set"];
  const two: Block[] = [
    { kind: "user", key: "u1", text: "First note.", meta: { entryId: "e1", timestamp: t0 } },
    { kind: "text", key: "a1", text: "Noted.", streaming: false, meta: { entryId: "e2", timestamp: t0 + 1_000 } },
    { kind: "user", key: "u2", text: "Second note.", meta: { entryId: "e3", timestamp: t0 + 2_000 } },
  ];
  await show({ history: two, onReply: () => undefined }, methods);
  const open = async (n: number) => {
    const bars = host.querySelectorAll('[data-testid="hover-bar"]');
    await act(async () => bars[n].querySelector<HTMLButtonElement>('[aria-label="More for this message"]')!.click());
    return [...document.querySelectorAll<HTMLElement>('[role="menu"][aria-label="Message"] [role="menuitem"]')].map((b) => b.textContent);
  };
  expect(await open(0)).not.toContain("Edit");
  expect(await open(0)).not.toContain("Retry");
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  const reply = await open(1);
  expect(reply).toContain("Retry");
  expect(reply).not.toContain("Edit");
  expect(reply).toContain("Look inside");
  expect(reply).not.toContain("Show what it did");
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(await open(2)).toContain("Edit");
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

  const room = { isRoom: true, selfId: "me", trunkName: () => "Scout", whereRuns: () => null };
  const shared: Block[] = [
    { kind: "user", key: "u1", text: "Mine.", meta: { entryId: "e1", timestamp: t0 } },
    { kind: "user", key: "u2", text: "Dana wrote this.", meta: { entryId: "e2", timestamp: t0 + 1_000, sender: { kind: "person", id: "dana", name: "Dana" } } },
  ];
  await show({ history: shared, room, onReply: () => undefined }, methods);
  expect(await open(0)).toContain("Edit");
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(await open(1)).not.toContain("Edit");
  await act(async () => document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

  localStorage.setItem("branch.level", "technical");
  await show({ history: two, onReply: () => undefined }, methods);
  const technical = await open(1);
  expect(technical).toContain("Show what it did");
  expect(technical).not.toContain("Look inside");
});

it("leaves the Trunk-getting-ready line to the window: no Opening line and no start screen while it waits", async () => {
  await show({ historyReady: false });
  expect(host.querySelector('[data-testid="opening"]')).not.toBeNull();
  await show({ historyReady: false, startupWaiting: true });
  expect(host.querySelector('[data-testid="opening"]')).toBeNull();
  expect(host.querySelector('[data-testid="empty-chat"]')).toBeNull();
  await show({ historyReady: true, startupWaiting: true });
  expect(host.querySelector('[data-testid="empty-chat"]')).toBeNull();
});
