// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Block } from "../../thread/model";
import { StepsList } from "./Steps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Step = Extract<Block, { kind: "step" }>;
const steps: Step[] = [
  { kind: "step", key: "s1", tool: "read", title: "notes.md", detail: "", status: "ok", output: "hello" },
  { kind: "step", key: "s2", tool: "exec", title: "npm test", detail: "Exit 2", status: "failed", output: "1 failing" },
];
const thoughts: Extract<Block, { kind: "thinking" }>[] = [{ kind: "thinking", key: "t1", text: "The tests fail because the fixture is stale. I will refresh it.", live: false }];
let root: Root, host: HTMLDivElement;
let n = 0;
/** Fresh step keys per test: a fold keeps the open/closed choice made for its key while the window lives. */
const fresh = (list: Step[]) => list.map((s) => ({ ...s, key: s.key + ":" + n }));
const freshThoughts = () => thoughts.map((t) => ({ ...t, key: t.key + ":" + n }));
beforeEach(() => { localStorage.clear(); n += 1; host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("Private #1103: a very long changed path ends in an ellipsis with Copy path, and a long step keeps its whole title", async () => {
  const path = "/Users/someone/Library/Application-Support/" + "a".repeat(300) + ".tsx";
  const writeText = vi.fn(async (_text: string) => undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const long: Step[] = [{ kind: "step", key: "long", tool: "edit", title: "Edited " + path, detail: "", status: "ok", changes: [{ path, added: 2, removed: 1 }] }];
  await act(async () => root.render(<StepsList steps={fresh(long)} live={false} mode="verbose" />));
  const file = host.querySelector(".r1c-step-file")!;
  expect(file.querySelector<HTMLElement>(".copy-token-text")!.title).toBe(path);
  expect(host.querySelector<HTMLElement>(".r1c-step-title")!.title).toBeTruthy();
  const copy = [...file.querySelectorAll("button")].find((b) => b.textContent === "Copy path")!;
  await act(async () => { copy.click(); });
  await act(async () => { await Promise.resolve(); });
  expect(writeText).toHaveBeenCalledWith(path);
  expect(copy.textContent).toBe("Copied");
});

it("Normal: one closed summary line with the failure count, no thoughts", async () => {
  await act(async () => root.render(<StepsList steps={fresh(steps)} thoughts={freshThoughts()} live={false} mode="normal" />));
  const fold = host.querySelector<HTMLDetailsElement>('[data-testid="steps"]')!;
  expect(fold.open).toBe(false);
  expect(fold.querySelector("summary")!.textContent).toContain("1 failed");
  expect(fold.querySelector("summary")!.textContent).not.toMatch(/\d+m \d+s|\dh /);
  expect(host.querySelectorAll('[data-testid="thought"]')).toHaveLength(0);
  expect(host.querySelectorAll('[data-testid="step"]')).toHaveLength(2);
});

it("Thinking: thoughts are quiet rows inside the steps", async () => {
  await act(async () => root.render(<StepsList steps={fresh(steps)} thoughts={freshThoughts()} live={false} mode="thinking" />));
  const row = host.querySelector('[data-testid="thought"]')!;
  expect(row.querySelector("summary")!.textContent).toContain("The tests fail because the fixture is stale.");
  expect(row.querySelector("details")!.hasAttribute("open")).toBe(false);
});

it("Verbose: every fold is open, with the failure's exit code in its detail", async () => {
  await act(async () => root.render(<StepsList steps={fresh(steps)} thoughts={freshThoughts()} live={false} mode="verbose" />));
  expect(host.querySelector<HTMLDetailsElement>('[data-testid="steps"]')!.open).toBe(true);
  expect([...host.querySelectorAll<HTMLDetailsElement>('[data-testid="step"] details')].every((d) => d.open)).toBe(true);
  expect(host.textContent).toContain("Exit code 2");
  expect(host.querySelector('[data-testid="thought"] details')!.hasAttribute("open")).toBe(true);
});

it("a live run shows how many steps so far, with no spinner in the summary", async () => {
  await act(async () => root.render(<StepsList steps={fresh([steps[0], { ...steps[1], status: "running", detail: "" }])} live mode="normal" />));
  const summary = host.querySelector('[data-testid="steps"] summary')!;
  expect(summary.querySelector(".r1c-spin")).toBeNull();
  expect(summary.textContent).toContain("2 steps so far");
});

it("Regular, live with a working label: the label is the disclosure, and the count stays inside", async () => {
  await act(async () => root.render(<StepsList steps={fresh([steps[0], { ...steps[1], status: "running", detail: "" }])} live mode="normal" working="Working in GitHub" />));
  const fold = host.querySelector<HTMLDetailsElement>('[data-testid="steps"]')!;
  expect(fold.querySelector(".r1c-steps-text")!.textContent).toBe("Working in GitHub");
  expect(fold.querySelector("summary")!.textContent).not.toContain("so far");
  fold.querySelector("summary")!.click();
  expect(host.querySelectorAll('[data-testid="step"]')).toHaveLength(2);
});

it("Advanced, live: the app in plain words and the count, never a tool's name", async () => {
  localStorage.setItem("branch.level", "advanced");
  await act(async () => root.render(<StepsList steps={fresh([steps[0], { ...steps[1], status: "running", detail: "" }])} live mode="normal" />));
  const summary = host.querySelector('[data-testid="steps"] summary')!;
  expect(summary.querySelector(".r1c-steps-text")!.textContent).toBe("Working on your computer · 2 steps so far");
  expect(summary.textContent).not.toContain("Running a command");
});

it("Advanced, live with a connected tool: its app, with no tool id", async () => {
  localStorage.setItem("branch.level", "advanced");
  const github: Step[] = [{ kind: "step", key: "g1", tool: "mcp__plugin_github_github__list_pull_requests", title: "", detail: "", status: "running" }];
  await act(async () => root.render(<StepsList steps={fresh(github)} live mode="normal" />));
  const text = host.querySelector('[data-testid="steps"] .r1c-steps-text')!.textContent!;
  expect(text).toBe("Working in GitHub · 1 step so far");
  expect(text).not.toContain("mcp__");
  expect(text).not.toContain("list pull requests");
});

it("Technical, live: the step words stay as they were", async () => {
  localStorage.setItem("branch.level", "technical");
  await act(async () => root.render(<StepsList steps={fresh([steps[0], { ...steps[1], status: "running", detail: "" }])} live mode="normal" />));
  expect(host.querySelector('[data-testid="steps"] .r1c-steps-text')!.textContent).toBe("Running a command…");
});

it("Regular: the finished steps are one quiet count, and the list still opens", async () => {
  localStorage.setItem("branch.level", "regular");
  await act(async () => root.render(<StepsList steps={fresh(steps)} thoughts={[]} live={false} mode="normal" />));
  const fold = host.querySelector<HTMLDetailsElement>('[data-testid="steps"]')!;
  expect(fold.className).toContain("r1c-steps-quiet");
  expect(fold.querySelector(".r1c-steps-text")!.textContent).toBe("2 steps");
  expect(fold.querySelector("summary")!.textContent).toContain("1 failed");
  expect(fold.querySelector("summary")!.textContent).not.toMatch(/read a file|ran a command/i);
  fold.querySelector("summary")!.click();
  expect(fold.open).toBe(true);
  expect(host.querySelectorAll('[data-testid="step"]')).toHaveLength(2);
});

it.each(["advanced", "technical"])("%s: the full sentence stays, with the failure count", async (level) => {
  localStorage.setItem("branch.level", level);
  await act(async () => root.render(<StepsList steps={fresh(steps)} thoughts={[]} live={false} mode="normal" />));
  const fold = host.querySelector<HTMLDetailsElement>('[data-testid="steps"]')!;
  expect(fold.querySelector(".r1c-steps-text")!.textContent).toBe("Ran a command and read a file");
  expect(fold.querySelector("summary")!.textContent).toContain("1 failed");
  expect(fold.className).not.toContain("r1c-steps-quiet");
});

it("a failed step gives a plain reason and never a local path, at every level", async () => {
  const failing: Step[] = [{ kind: "step", key: "f1", tool: "read", title: "notes", detail: "Permission denied: /Users/someone/Secret/notes.txt", status: "failed" }];
  for (const level of ["regular", "advanced", "technical"]) {
    localStorage.setItem("branch.level", level);
    await act(async () => root.render(<StepsList steps={fresh(failing)} thoughts={[]} live={false} mode="normal" />));
    expect(host.querySelector(".r1c-step-err")!.textContent).toBe("Permission denied: a local file");
    expect(host.textContent).not.toContain("/Users");
  }
});
