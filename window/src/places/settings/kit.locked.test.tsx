// @vitest-environment jsdom
// DA-81: a locked switch that is on keeps full contrast, and a locked row always says why under itself.
import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Ctl, Switch } from "./kit";
import { visibleDevNotes } from "../../shell/shown-why.testing";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLElement;
beforeEach(() => {
  const style = document.createElement("style");
  style.textContent = readFileSync("src/places/settings/kit.css", "utf8");
  document.head.appendChild(style);
  host = document.body.appendChild(document.createElement("div"));
  host.className = "set-col";
});
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});
async function render(children: React.ReactNode) {
  root = createRoot(host);
  await act(async () => root?.render(children));
}
const noop = () => undefined;
const LOCKED_YET = "Branch can’t change this yet.";
const LOCKED_UPDATE = "Update Branch to change this.";
const row = (title: string) => host.querySelector<HTMLElement>(`.ctl[data-row="${title}"]`)!;
const sw = (title: string) => row(title).querySelector<HTMLInputElement>("input[role=switch]")!;
/** The opacity the person sees: the element's own times every ancestor's. */
function seenOpacity(el: Element | null): number {
  let seen = 1;
  for (let at = el; at; at = at.parentElement) {
    const o = Number.parseFloat(getComputedStyle(at).opacity);
    if (Number.isFinite(o)) seen *= o;
  }
  return seen;
}

describe("locked settings switches (DA-81)", () => {
  it("draws an on-but-locked switch at full contrast and says why under it", async () => {
    await render(
      <Ctl title="Message box grows with the text" sub="Off keeps it one size." off="Branch has no setting for this yet.">
        <Switch checked label="Message box grows with the text" onChange={noop} />
      </Ctl>,
    );
    const r = row("Message box grows with the text");
    expect(r.getAttribute("aria-disabled")).toBe("true");
    expect(sw("Message box grows with the text").checked).toBe(true);
    expect(seenOpacity(sw("Message box grows with the text"))).toBe(1);
    expect(seenOpacity(r.querySelector("b"))).toBe(1);
    expect(r.querySelector(".why-k")?.textContent).toBe(LOCKED_YET);
    expect(seenOpacity(r.querySelector(".why-k"))).toBe(1);
    expect(visibleDevNotes(host)).toEqual([]);
  });

  it("keeps a disabled on switch at full contrast outside a locked row", async () => {
    await render(
      <Ctl title="Move to the next account in the list" sub="Only switches between accounts you own.">
        <Switch checked disabled label="Move to the next account in the list" onChange={noop} />
      </Ctl>,
    );
    expect(seenOpacity(sw("Move to the next account in the list"))).toBe(1);
  });

  it("fades a locked switch that is off, and still says why", async () => {
    await render(
      <Ctl title="Suggest the rest as I type" off="Branch has no setting for this yet.">
        <Switch checked={false} label="Suggest the rest as I type" onChange={noop} />
      </Ctl>,
    );
    expect(seenOpacity(sw("Suggest the rest as I type"))).toBeLessThan(1);
    expect(row("Suggest the rest as I type").textContent).toContain(LOCKED_YET);
  });

  it("shows a plain reason as it is, and asks for an update for an older Branch app", async () => {
    await render(
      <>
        <Ctl title="Fall back to this computer" off="Needs a model on this computer first."><Switch checked label="Fall back to this computer" onChange={noop} /></Ctl>
        <Ctl title="Type branch in any terminal" sub="Adds the branch command." off="Needs a newer Branch app"><Switch checked={false} label="Type branch in any terminal" onChange={noop} /></Ctl>
      </>,
    );
    expect(row("Fall back to this computer").textContent).toContain("Needs a model on this computer first.");
    expect(row("Type branch in any terminal").querySelector(".why-k")?.textContent).toBe(LOCKED_UPDATE);
    expect(visibleDevNotes(host)).toEqual([]);
  });
});
