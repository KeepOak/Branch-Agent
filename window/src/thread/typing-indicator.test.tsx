// @vitest-environment jsdom
// P47: while a reply starts, the typing indicator shows the Trunk's face and the dots, and words only when they
// say something the dots do not (folder, separate copy, setup, computer, memory, a retry).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Typing } from "./blocks";
import type { Block } from "./model";

vi.mock("../face/Face", () => ({ Face: () => <span data-testid="face" /> }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function renderPhase(phase: string, attempt?: number, maxAttempts?: number): Promise<Element | null> {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  const status: Extract<Block, { kind: "status" }> = { kind: "status", key: "status", phase, attempt, maxAttempts };
  await act(async () => root?.render(<Typing name="Research" status={status} />));
  return host.querySelector('[data-testid="typing"]');
}

describe("typing indicator", () => {
  it.each(["preparing_context", "starting_model", "waiting_for_state"])("a filler phase (%s) shows only the face and the dots", async (phase) => {
    const typing = await renderPhase(phase);
    expect(typing?.querySelector('[data-testid="face"]')).not.toBeNull();
    expect(typing?.querySelectorAll(".typing i")).toHaveLength(3);
    expect(typing?.querySelector(".typing-words")).toBeNull();
    expect(typing?.textContent).toBe("");
  });

  it("an informative phase shows its words with the full text on hover", async () => {
    const typing = await renderPhase("creating_worktree");
    const words = typing?.querySelector<HTMLElement>(".typing-words");
    expect(words?.textContent).toBe("Making a separate copy…");
    expect(words?.title).toBe("Making a separate copy…");
  });

  it("a retry shows the attempt line", async () => {
    const typing = await renderPhase("starting_model", 2, 3);
    expect(typing?.querySelector(".typing-words")?.textContent).toBe("Trying again… 2 of 3");
  });

  it("the words stay on one line with an ellipsis", () => {
    const css = readFileSync(join(process.cwd(), "src/thread/thread.css"), "utf8");
    const rule = /\.thread \.typing-words\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/white-space:\s*nowrap/);
    expect(rule).toMatch(/text-overflow:\s*ellipsis/);
    expect(rule).toMatch(/overflow:\s*hidden/);
    expect(rule).toMatch(/min-width:\s*0/);
  });
});
