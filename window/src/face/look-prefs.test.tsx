// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { lookPrefsOf, useLookPrefs } from "./look-prefs";
import { shownState } from "./Face";

function Probe() {
  const p = useLookPrefs();
  return <span data-testid="p">{`${p.agentSize}|${p.headlines}|${p.actsOut}|${p.reactsToTouch}`}</span>;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
const text = () => document.querySelector("[data-testid=p]")?.textContent;

describe("Appearance rows faces and the list follow", () => {
  it("falls back to each row's default", () => {
    expect(lookPrefsOf({})).toEqual({ agentSize: "m", headlines: true, liveInList: true, actsOut: true, movesWhileSpeaking: true, reactsToTouch: true, captions: true });
    expect(lookPrefsOf({ agentSize: "xl", headlines: false, "show.live": false, "ch.act": false, "ch.cap": false })).toMatchObject({ agentSize: "m", headlines: false, liveInList: false, actsOut: false, captions: false });
    expect(lookPrefsOf({ agentSize: "l" }).agentSize).toBe("l");
  });

  it("follows the look store's change event", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    await act(async () => { root = createRoot(host); root.render(<Probe />); });
    act(() => { window.dispatchEvent(new CustomEvent("branch:look-change", { detail: { look: { agentSize: "s", headlines: false, "ch.touch": false } } })); });
    expect(text()).toBe("s|false|true|false");
    act(() => { window.dispatchEvent(new CustomEvent("branch:look-change", { detail: { look: { "ch.act": false } } })); });
    expect(text()).toBe("m|true|false|true");
  });

  it("keeps a face still when acting out or moving while speaking is off", () => {
    const on = { actsOut: true, movesWhileSpeaking: true };
    expect(shownState("work", on)).toBe("work");
    expect(shownState("work", { ...on, actsOut: false })).toBe("idle");
    expect(shownState("yay", { ...on, actsOut: false })).toBe("idle");
    expect(shownState("sleep", { ...on, actsOut: false })).toBe("sleep");
    expect(shownState("talk", { ...on, actsOut: false })).toBe("talk");
    expect(shownState("talk", { ...on, movesWhileSpeaking: false })).toBe("idle");
  });
});
