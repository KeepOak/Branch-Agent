// C4: one quiet working line. Live it names the current step and the time; a click opens the steps in plain
// words and a second click closes them. When the reply finishes it stays as "Worked for 42s · 6 steps", and
// the answer is its own message below.
// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Block } from "../../thread/model";
import { currentStepWords, liveWorkingLine, workedForLine } from "../../thread/format";
import { ChatView } from "./ChatView";

vi.mock("../../face/Face", () => ({ Face: ({ label }: { label: string }) => <span data-face={label} /> }));
vi.mock("../../composer/useConversation", () => ({ useConversation: () => ({ loaded: false }), hasNoModel: () => true }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 16, 12, 0, 0).getTime();
let root: Root, host: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const step = (key: string, over: Partial<Extract<Block, { kind: "step" }>> = {}): Extract<Block, { kind: "step" }> => ({
  kind: "step", key, tool: "read", title: "notes.md", detail: "", status: "ok", at: NOW - 42_000, ...over,
});

async function show(props: { history?: Block[]; live?: Block[]; running?: boolean }) {
  await act(async () => root.render(<ChatView name="Scout" history={props.history ?? []} live={props.live ?? []} pendingUser={null} running={props.running ?? false} onAnswer={() => undefined} />));
}

describe("the words", () => {
  it("names the live step and the finished run exactly", () => {
    const running = step("s", { status: "running", at: NOW - 12_000 });
    expect(currentStepWords([running])).toBe("Reading a file");
    expect(liveWorkingLine(currentStepWords([running]), 12_000)).toBe("Working… Reading a file · 12s");
    expect(liveWorkingLine(undefined, 0)).toBe("Working…");
    expect(workedForLine(6, 42_000)).toBe("Worked for 42s · 6 steps");
    expect(workedForLine(1, 42_000)).toBe("Worked for 42s · 1 step");
    expect(liveWorkingLine("Reading a file", 12_000)).not.toMatch(/mcp__|\/|notes\.md/);
  });
});

describe("the conversation", () => {
  const six = ["s1", "s2", "s3", "s4", "s5", "s6"].map((key, i) => step(key, { at: NOW - 42_000 + i * 1000 }));
  const answer: Block = { kind: "text", key: "a1", text: "The notes are ready.", streaming: false, meta: { timestamp: NOW } };
  const done: Block = { kind: "done", key: "r1:done", runId: "r1", durationMs: 42_000 };
  const asked: Block = { kind: "user", key: "u1", text: "Read the notes.", meta: { timestamp: NOW - 60_000 } };

  it("shows one closed working line while the Trunk works, then the answer below it", async () => {
    const live: Block[] = [
      { kind: "text", key: "a1", text: "The notes are ready.", streaming: true },
      step("s1", { status: "ok", at: NOW - 12_000 }),
      step("s2", { tool: "exec", title: "ls ~/Documents", status: "running", at: NOW - 12_000 }),
    ];
    await show({ history: [asked], live, running: true });
    const folds = host.querySelectorAll<HTMLDetailsElement>('[data-testid="steps"]');
    expect(folds).toHaveLength(1);
    expect(folds[0].open).toBe(false);
    expect(host.querySelector('[data-testid="working-line"]')).toBeNull();
    expect(folds[0].querySelector(".r1c-steps-text")!.textContent).toBe("Working… Running a command · 12s");
    const reply = host.querySelector('[data-role="assistant"]')!;
    expect(folds[0].compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(reply.textContent).toContain("The notes are ready.");
  });

  it("opens the step list in plain words and closes it again", async () => {
    const live: Block[] = [
      step("s1", { status: "ok", at: NOW - 12_000 }),
      step("s2", { tool: "exec", title: "ls ~/Documents", status: "running", at: NOW - 12_000 }),
      step("s3", { tool: "mcp__plugin_github_github__list_pull_requests", title: "KeepOak/Branch-Agent", status: "ok", at: NOW - 12_000 }),
    ];
    await show({ history: [asked], live, running: true });
    const fold = host.querySelector<HTMLDetailsElement>('[data-testid="steps"]')!;
    const summary = fold.querySelector("summary")!;
    await act(async () => summary.click());
    expect(fold.open).toBe(true);
    const titles = [...fold.querySelectorAll(".r1c-step-title")].map((el) => el.textContent);
    expect(titles).toEqual(["Read a file", "Running a command", "Used list pull requests"]);
    expect(titles.join(" ")).not.toMatch(/mcp__|ls ~|KeepOak|notes\.md/);
    await act(async () => summary.click());
    expect(fold.open).toBe(false);
  });

  it("keeps a collapsed summary after the reply finishes, and the answer stays below it", async () => {
    await show({ history: [asked, ...six, answer, done] });
    const fold = host.querySelector<HTMLDetailsElement>('[data-testid="steps"]')!;
    expect(fold.open).toBe(false);
    expect(fold.querySelector(".r1c-steps-text")!.textContent).toBe("Worked for 42s · 6 steps");
    expect(host.querySelector('[data-testid="working-line"]')).toBeNull();
    const reply = host.querySelector('[data-role="assistant"]')!;
    expect(reply.textContent).toContain("The notes are ready.");
    expect(fold.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await act(async () => fold.querySelector("summary")!.click());
    expect(fold.open).toBe(true);
    expect([...fold.querySelectorAll(".r1c-step-title")].map((el) => el.textContent)).toEqual(Array(6).fill("Read a file"));
    expect(fold.textContent).not.toContain("notes.md");
  });
});
