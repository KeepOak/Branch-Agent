// Ported dump/data embedding cases from UI-TARS-desktop@2ff41a9e515828c5bd5b276e493d73aa0bdf4a3a:
// multimodal/tarko/agent-ui-builder/tests/builder.test.ts; controls exercise the pinned useReplay.ts semantics.
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type { Block } from "../thread/model";
import { eventsToReplayHtml, safeReplayJson } from "./replay-html";

const blocks: Block[] = [
  { kind: "user", key: "u", text: "Question", meta: { timestamp: 1000 } },
  { kind: "step", key: "s", tool: "fixture", title: "Read fixture", detail: "private tool arguments", output: "private tool result", status: "ok" },
  { kind: "text", key: "a", text: "Answer " + "x".repeat(900), streaming: false, meta: { timestamp: 2000 } },
];
const options = { title: "Fixture conversation", model: "fixture-model", includeToolDetails: true, includeTimestamps: true };

function playback(events: Block[] = blocks) {
  const timers = new Map<number, { callback: () => void; ms: number }>();
  let next = 0;
  const dom = new JSDOM(eventsToReplayHtml(events, options), {
    runScripts: "dangerously",
    beforeParse(window) {
      window.setInterval = (handler, ms) => { const id = ++next; timers.set(id, { callback: handler as () => void, ms: Number(ms) }); return id; };
      window.clearInterval = id => { if (id !== undefined) timers.delete(id); };
    },
  });
  const document = dom.window.document;
  const click = (id: string) => document.getElementById(id)!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const visible = () => [...document.querySelectorAll<HTMLElement>("#branch-replay-events > *")].filter(element => !element.hidden);
  const tick = () => { for (const timer of [...timers.values()]) timer.callback(); };
  return { dom, document, timers, click, tick, visible };
}

describe("self-contained conversation replay export", () => {
  it("embeds full session events and metadata without external assets", () => {
    const html = eventsToReplayHtml(blocks, options);
    const dom = new JSDOM(html);
    const data = JSON.parse(dom.window.document.getElementById("branch-replay-data")!.textContent!);
    expect(data.session).toEqual({ id: null, title: options.title, model: options.model });
    expect(data.events).toHaveLength(3);
    expect(data.events[2].content).toBe(blocks[2].kind === "text" ? blocks[2].text : "");
    expect(dom.window.document.querySelectorAll("script[src],link[href],img[src],iframe")).toHaveLength(0);
    dom.window.close();
  });
  it("keeps excluded tool details and timestamps out of the file and its event data", () => {
    const html = eventsToReplayHtml(blocks, { ...options, includeToolDetails: false, includeTimestamps: false });
    expect(html).not.toContain("private tool");
    expect(html).not.toContain("1970-01-01");
    expect(html).toContain("Read fixture");
  });
  it("escapes embedded HTML/script terminators and renders untrusted content inertly", () => {
    const text = '</script><script>window.compromised = true</script><img src=x onerror="window.compromised=true">';
    const p = playback([{ kind: "user", key: "hostile", text }]);
    p.click("branch-replay-play"); p.tick();
    expect(p.visible()[0].textContent).toContain(text);
    expect(p.document.querySelector("img")).toBeNull();
    expect((p.dom.window as unknown as Record<string, unknown>).compromised).toBeUndefined();
    expect(safeReplayJson({ text })).not.toContain("<");
    p.dom.window.close();
  });
  it("executes the exported script: play, pause, seek backwards, speed, restart and final state", () => {
    const p = playback();
    expect(p.visible()).toHaveLength(0);
    expect(p.document.querySelector("h1")!.hidden).toBe(false);
    p.click("branch-replay-play"); expect([...p.timers.values()][0].ms).toBe(800);
    p.tick(); expect(p.visible()).toHaveLength(1);
    p.click("branch-replay-play"); expect(p.timers.size).toBe(0);
    p.click("branch-replay-end"); expect(p.visible()).toHaveLength(3);
    const timeline = p.document.querySelector<HTMLInputElement>("#branch-replay-position")!;
    timeline.value = "0.5"; timeline.dispatchEvent(new p.dom.window.Event("input"));
    expect(p.visible()).toHaveLength(2); expect(p.timers.size).toBe(0);
    p.document.querySelector<HTMLButtonElement>('[data-replay-speed="0.5"]')!.click();
    p.click("branch-replay-restart"); expect(p.visible()).toHaveLength(0);
    expect([...p.timers.values()][0].ms).toBe(1600);
    p.tick(); p.document.querySelector<HTMLButtonElement>('[data-replay-speed="4"]')!.click();
    expect([...p.timers.values()][0].ms).toBe(200);
    p.tick(); p.tick(); expect(p.visible()).toHaveLength(3); expect(p.timers.size).toBe(0);
    expect(p.document.getElementById("branch-replay-progress")!.textContent).toBe("3 of 3");
    expect(p.visible()[2].textContent).toContain("x".repeat(900));
    p.dom.window.close();
  });
  it("disables controls for an empty recording and clears timers on leaving the file", () => {
    const empty = playback([]);
    expect(empty.document.querySelector<HTMLButtonElement>("#branch-replay-play")!.disabled).toBe(true);
    expect(empty.document.querySelector<HTMLInputElement>("#branch-replay-position")!.disabled).toBe(true);
    empty.dom.window.close();
    const p = playback(); p.click("branch-replay-play");
    p.dom.window.dispatchEvent(new p.dom.window.Event("pagehide"));
    expect(p.timers.size).toBe(0);
    p.dom.window.close();
  });
});
