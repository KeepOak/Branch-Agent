// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Topic } from "@branch/gateway-protocol";
import { TopicsNav, useTopicLayout } from "./TopicsNav";
import { AllTopicsView } from "./AllTopicsView";
import { loadCompleteTranscript } from "../transcript-export/load";

vi.mock("../transcript-export/load", () => ({ loadCompleteTranscript: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const FIRST: Topic = { key: "agent:oak:window:invoice", contactId: "trunk:oak", title: "Invoice", status: "working", unread: true, emoji: "🧾", emojiSaved: true };
const CLOSED: Topic = { key: "agent:oak:window:old", contactId: "trunk:oak", title: "Old work", status: "archived", unread: false, emoji: "📎", emojiSaved: true };
const items = [{ topic: FIRST, updatedAt: 100, preview: "Receipt ready" }, { topic: CLOSED, updatedAt: 50, preview: "Done" }];
let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => { if (root) await act(async () => root?.unmount()); root = null; host?.remove(); host = null; localStorage.removeItem("branch.topic-layout"); });
const patch = vi.fn(async () => {});
const open = vi.fn();
const all = vi.fn();
function Harness() {
  const layout = useTopicLayout("trunk:oak");
  return <TopicsNav contactId="trunk:oak" contactName="Oak" generalKey="agent:oak:main" items={items} activeKey={FIRST.key} allSelected={false}
    layout={layout.layout} width={layout.width} phoneList={false} onOpen={open} onAll={all} onLayout={layout.choose} onResize={layout.resize} onPatch={patch} />;
}
async function show() { host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root?.render(<Harness />)); return host; }
async function click(label: string) { const control = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === label || button.getAttribute("aria-label") === label); if (!control) throw new Error(`Missing ${label}`); await act(async () => control.click()); }
async function type(input: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); }

it("column shows emoji, title, time, preview, status and unread, with closed topics at the bottom", async () => {
  const page = await show();
  expect(page.querySelector(".topics-nav")?.classList.contains("lay-column")).toBe(true);
  expect(page.textContent).toContain("Invoice"); expect(page.textContent).toContain("Oak: Receipt ready");
  expect(page.textContent).toContain("working"); expect(page.querySelector('[aria-label="Unread"]')).not.toBeNull();
  expect(page.textContent).toContain("Closed · 1"); expect(page.textContent).not.toContain("Old work");
  await click("Closed · 1"); expect(page.textContent).toContain("Old work");
  expect(page.querySelector('[aria-label="All"]')).toBeNull();
});

it("layout picker switches rail, side tabs and top tabs and keeps the selection after remount", async () => {
  const page = await show();
  await click("How threads show: Column"); await click("Emoji rail");
  expect(page.querySelector(".topics-nav")?.classList.contains("lay-rail")).toBe(true);
  const separator = page.querySelector<HTMLElement>('[role="separator"]');
  expect(separator).not.toBeNull();
  await act(async () => separator?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  await click("How threads show: Emoji rail"); await click("Side tabs");
  expect(page.querySelector(".topics-nav")?.classList.contains("lay-side")).toBe(true);
  expect(page.textContent).toContain("Old work");
  await click("All"); expect(all).toHaveBeenCalledTimes(1);
  await click("How threads show: Side tabs"); await click("Tabs above the chat");
  expect(page.querySelector(".topics-nav")?.classList.contains("lay-tabs")).toBe(true);
  await act(async () => root?.unmount()); root = createRoot(page);
  await act(async () => root?.render(<Harness />));
  expect(page.querySelector(".topics-nav")?.classList.contains("lay-tabs")).toBe(true);
});

it("emoji picker searches the full catalog and saves the chosen emoji on the thread", async () => {
  patch.mockClear(); await show();
  await click("Change the emoji for Invoice");
  const search = document.querySelector<HTMLInputElement>('input[aria-label="Search emoji"]');
  expect(search?.placeholder).toMatch(/Search 13\d\d emoji/);
  if (!search) throw new Error("Missing emoji search");
  await type(search, "rocket");
  await click("rocket");
  expect(patch).toHaveBeenCalledWith(FIRST, { icon: "🚀" });
});

it("thread menu persists rename, pin, mute and close through the patch action", async () => {
  patch.mockClear(); await show();
  await click("More for Invoice"); await click("Pin"); expect(patch).toHaveBeenCalledWith(FIRST, { pinned: true });
  await click("More for Invoice"); await click("Mute"); expect(patch).toHaveBeenCalledWith(FIRST, { topicMuted: true });
  await click("More for Invoice"); await click("Close"); expect(patch).toHaveBeenCalledWith(FIRST, { archived: true });
  await click("More for Invoice"); await click("Rename");
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Title"]');
  if (!input) throw new Error("Missing title input");
  await type(input, "Bills");
  await act(async () => input.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(patch).toHaveBeenCalledWith(FIRST, { label: "Bills" });
});

it("All interleaves real transcripts by timestamp and opens the labelled thread", async () => {
  const transcript = vi.mocked(loadCompleteTranscript);
  transcript.mockImplementation(async (_engine, key) => key === "agent:oak:main"
    ? [{ key: "a", kind: "user", text: "Start", meta: { timestamp: 10 } }, { key: "c", kind: "text", text: "General reply", meta: { timestamp: 30 } }] as never
    : [{ key: "b", kind: "text", text: "Receipt ready", meta: { timestamp: 20 } }] as never);
  const page = document.createElement("div"); document.body.append(page); host = page; root = createRoot(page);
  await act(async () => root?.render(<AllTopicsView engine={{} as never} generalKey="agent:oak:main" contactName="Oak" topics={[items[0]!]} onOpen={open} />));
  expect(page.textContent?.indexOf("Start")).toBeLessThan(page.textContent!.indexOf("Receipt ready"));
  expect(page.textContent?.indexOf("Receipt ready")).toBeLessThan(page.textContent!.indexOf("General reply"));
  expect(page.querySelectorAll(".topic-all-label")).toHaveLength(3);
  const invoice = [...page.querySelectorAll<HTMLButtonElement>(".topic-all-label")].find((button) => button.textContent?.includes("Invoice"));
  await act(async () => invoice?.click());
  expect(open).toHaveBeenCalledWith(FIRST.key);
});
