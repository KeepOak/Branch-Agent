// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Btn, Ctl, KitProvider, type Lv } from "./kit";

const NOOP = { saving: () => undefined, saved: () => undefined, failed: () => undefined };
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function show(level: Lv) {
  await act(async () => root.render(
    <KitProvider level={level} report={NOOP} scope={null}>
      <Ctl title="Checkpoints" sub="Kept before a Trunk changes files." coming off="Listing checkpoints needs a checkpoint method in the engine."><Btn sm>See all</Btn></Ctl>
      <Ctl title="Copy seed" off="Copy seed comes in a later update."><Btn sm>Copy</Btn></Ctl>
      <Ctl title="Run now" off="Turn on “Compress older transcripts” first."><Btn sm>Run now</Btn></Ctl>
      <Ctl title="Memory wiki" off="Its plugin isn’t installed in this engine."><Btn sm>On</Btn></Ctl>
      <Ctl title="Keep conversations"><Btn sm>30 days</Btn></Ctl>
    </KitProvider>,
  ));
}
const rows = () => [...host.querySelectorAll("[data-row]")].map((r) => r.getAttribute("data-row"));

describe("Settings rows greyed as Coming wait for Technical (Private #1093)", () => {
  it("hides a Coming row at Regular and Advanced and keeps a row greyed for a real condition", async () => {
    for (const level of [0, 1] as const) {
      await show(level);
      expect(rows()).toEqual(["Run now", "Memory wiki", "Keep conversations"]);
      expect(host.querySelector('[data-row="Run now"]')?.getAttribute("aria-disabled")).toBe("true");
      expect(host.textContent).toContain("Turn on “Compress older transcripts” first.");
    }
  });

  it("shows every row, Coming included, at Technical", async () => {
    await show(2);
    expect(rows()).toEqual(["Checkpoints", "Copy seed", "Run now", "Memory wiki", "Keep conversations"]);
    expect(host.querySelector('[data-row="Checkpoints"]')?.getAttribute("aria-disabled")).toBe("true");
  });
});
