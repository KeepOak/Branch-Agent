// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Block } from "../../thread/model";
import { StepsList } from "./Steps";

/* README item 48 (owner, final): the conversation is clear glass; its words, chips, steps list and hover bar sit on the
   shared frosted pill (--gp-*), never on the earlier frosted fills (--gc, --gf, --gk, g-chip). Dialogs are clear glass. A step's Full output dialog is clear (.g-clear), its title and the
   output sit on frosted pills, and Close stays solid. It draws over the whole window (a portal on the body). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Step = Extract<Block, { kind: "step" }>;
const steps: Step[] = [{ kind: "step", key: "g48-s1", tool: "exec", title: "npm test", detail: "Exit 2", status: "failed", output: "1 failing" }];
let root: Root, host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });
/** Text that sits straight on a surface instead of on a pill. */
function bareText(scope: Element) {
  const bare: string[] = [];
  for (const el of scope.querySelectorAll("*")) {
    if (el.closest("svg, script, style")) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && /\S/.test(n.nodeValue ?? ""))) continue;
    const pill = el.closest(".g-label, .g-frost, button, a[href], select");
    if (!pill || (!pill.matches(".g-label, .g-frost") && !pill.closest(".g-clear"))) bare.push(`<${el.tagName.toLowerCase()} class="${el.className}"> ${el.textContent!.trim().slice(0, 48)}`);
  }
  return bare;
}

it("opens a step's Full output as a clear dialog with the output on a pill and Close solid", async () => {
  await act(async () => root.render(<StepsList steps={steps} live={false} mode="verbose" />));
  const show = host.querySelector<HTMLButtonElement>('[aria-label="Show full output"]');
  expect(show).not.toBeNull();
  await act(async () => show!.click());
  const dlg = document.querySelector('[data-testid="step-full-output"]')!;
  expect(dlg.classList).toContain("g-clear");
  expect(host.contains(dlg), "draws over the whole window, not inside the steps list").toBe(false);
  expect(dlg.querySelector(".dlg-h h2")!.classList).toContain("g-label");
  expect(dlg.querySelector("pre.r1c-full")!.classList).toContain("g-label");
  expect(dlg.querySelector("pre.r1c-full")!.textContent).toBe("1 failing");
  expect([...dlg.querySelectorAll(".dlg-f button")].find((b) => b.textContent === "Close")!.hasAttribute("data-solid")).toBe(true);
  expect(bareText(dlg)).toEqual([]);
});

it("draws the conversation from the shared pill tokens only, with no earlier frosted fill or g-chip left", () => {
  const css = readFileSync("src/screens/chat/chat.css", "utf8");
  expect(css).not.toMatch(/var\(--g[cfk]-/);
  for (const file of ["ChatView.tsx", "HoverBar.tsx", "Message.tsx", "Steps.tsx", "lines.tsx"]) {
    for (const old of ["g-chip", "g-ctl", "g-float"]) expect(readFileSync("src/screens/chat/" + file, "utf8"), file).not.toMatch(new RegExp(`["\\s]${old}["\\s]`));
  }
});
