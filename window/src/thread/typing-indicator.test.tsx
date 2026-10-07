// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Typing } from "./blocks";
import type { Block } from "./model";

vi.mock("../face/Face", () => ({ Face: () => <span data-testid="face" /> }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let host: HTMLDivElement;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function renderPhase(phase: string, attempt?: number, maxAttempts?: number) {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  const status: Extract<Block, { kind: "status" }> = {
    kind: "status", key: "status", phase, attempt, maxAttempts,
  };
  await act(async () => root?.render(<Typing name="Research" status={status} />));
  return host.querySelector('[data-testid="typing"]');
}

it("typing indicator shows only avatar and dots while preparing context", async () => {
  const typing = await renderPhase("preparing_context");
  expect(typing?.querySelectorAll(".typing i")).toHaveLength(3);
  expect(typing?.querySelector('[data-testid="face"]')).not.toBeNull();
  expect(typing?.querySelector(".typing-words")).toBeNull();
});

it("typing indicator shows informative worktree words on one ellipsized line", async () => {
  const typing = await renderPhase("creating_worktree");
  const words = typing?.querySelector<HTMLElement>(".typing-words");
  expect(words?.textContent).toBe("Making a separate copy…");
  expect(words?.title).toBe(words?.textContent);
  const css = readFileSync(join(process.cwd(), "src/thread/thread.css"), "utf8");
  const rule = css.match(/\.thread \.typing-words\s*\{([^}]*)\}/)?.[1];
  expect(rule).toMatch(/white-space:\s*nowrap/);
  expect(rule).toMatch(/text-overflow:\s*ellipsis/);
});

it("typing indicator shows the retry attempt", async () => {
  const typing = await renderPhase("starting_model", 2, 3);
  expect(typing?.querySelector(".typing-words")?.textContent).toBe("Trying again… 2 of 3");
});
