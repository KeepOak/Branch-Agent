// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlanCard, type ProgressCard } from "../thread/PlanCard";
import { DockRow } from "./DockRow";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
class Watch {
  static all: Watch[] = [];
  el!: Element;
  intersects = true;
  disconnected = false;
  private callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit;
  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
    this.callback = callback; this.options = options; Watch.all.push(this);
  }
  observe(el: Element) { this.el = el; }
  disconnect() { this.disconnected = true; }
  fire(intersects: boolean) {
    this.intersects = intersects;
    this.callback([{ isIntersecting: intersects } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}
const live: ProgressCard = {
  sessionKey: "demo:plan", revision: 1, updatedAt: 1000, markdown: "Checking the demo plan.",
  steps: [{ step: "Read source", status: "completed" }, { step: "Verify behavior", status: "in_progress" }, { step: "Publish proof", status: "pending" }],
};
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  Watch.all = [];
  vi.stubGlobal("IntersectionObserver", Watch);
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
const noop = () => {};
async function render({ card = live, mounted = true, moved = false, working = true, enabled = true, folded = false, run = false, sessionKey = live.sessionKey } = {}) {
  const steps = card.steps!;
  await act(async () => root.render(<>
    <div className="scroll"><div className="thread">
      {mounted && !moved ? <PlanCard card={card} /> : null}
      {mounted && moved ? <article><PlanCard card={card} /></article> : null}
      {run ? <aside><PlanCard card={{ ...live, sessionKey: "run" }} /></aside> : null}
    </div></div>
    <DockRow sessionKey={sessionKey} working={working} plan={enabled ? { steps, total: steps.length, done: steps.filter(s => s.status === "completed").length } : null} planStarts={folded ? "folded" : "open"}
      trunkName="Demo" offline={false} line={[]} jobs={[]} goal={null} files={[]} preparing={0} people={[]}
      onReword={noop} onMoveUp={noop} onRemove={noop} onSteerQueued={noop} onRetry={noop} onStopJob={noop} onGoal={noop} onRemoveFile={noop} onShowText={noop} onForget={noop} onSteer={async () => true} />
  </>));
}
const count = (id: string) => container.querySelectorAll(`[data-testid="${id}"]`).length;
// The count inside the expanded dock is part of that view, not a second view.
function visiblePlanViews() {
  const cards = Watch.all.filter(w => !w.disconnected && w.el.isConnected && w.intersects).length;
  return cards + (count("plan-dock") || count("plan-chip"));
}
async function fire(value: boolean, watch = Watch.all[0]) { await act(async () => watch.fire(value)); }
it("a live plan renders exactly one view before its observer reports", async () => {
  await render(); expect(count("plan-card")).toBe(1); expect(count("plan-dock")).toBe(0); expect(count("plan-chip")).toBe(0); expect(visiblePlanViews()).toBe(1);
  expect(Watch.all[0].options).toEqual({ root: container.querySelector(".scroll"), threshold: 0.2 });
});
it("shows the tracker only out of view and removes it on return", async () => {
  await render(); await fire(false); expect(count("plan-dock")).toBe(1); expect(container.querySelector(".c-plan")?.textContent).toContain("1 of 3Show the plan");
  expect(container.querySelectorAll(".c-plan li")).toHaveLength(3); expect(visiblePlanViews()).toBe(1);
  await fire(true); expect(count("plan-dock")).toBe(0); expect(visiblePlanViews()).toBe(1);
});
it("registers a card that mounts after the dock without a dead tracker", async () => {
  await render({ mounted: false }); expect(count("plan-chip")).toBe(0);
  await render(); expect(count("plan-dock")).toBe(0); expect(visiblePlanViews()).toBe(1);
});
it("re-watches a remounted card and ignores detached observer reports", async () => {
  await render(); const old = Watch.all[0]; await fire(false); await render({ moved: true });
  expect(old.disconnected).toBe(true); expect(Watch.all[1].el).not.toBe(old.el); expect(count("plan-dock")).toBe(0);
  await fire(false, old); expect(visiblePlanViews()).toBe(1);
});
it.each([false, true])("scrolls the registered card from the %s folded tracker", async (folded) => {
  await render({ folded }); await fire(false); const scroll = vi.fn(); Object.assign(Watch.all[0].el, { scrollIntoView: scroll });
  await act(async () => container.querySelector<HTMLButtonElement>(folded ? '[data-testid="plan-chip"]' : ".c-link")!.click());
  expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
  expect(count("plan-chip")).toBe(0);
  await fire(false);
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="plan-chip"]')!.click());
  expect(scroll).toHaveBeenLastCalledWith({ block: "center", behavior: "auto" });
});
it("removes the tracker when work stops or the plan finishes", async () => {
  await render(); await fire(false); await render({ working: false }); expect(count("plan-chip")).toBe(0);
  await render({ card: { ...live, steps: live.steps!.map(s => ({ ...s, status: "completed" })) } });
  expect(count("plan-chip")).toBe(0); expect(container.querySelector(".plan-end")?.textContent).toBe("Done");
});
it("keeps only the card when task progress is off", async () => {
  await render({ enabled: false }); await fire(false); expect(count("plan-chip")).toBe(0); expect(count("plan-card")).toBe(1);
});
it("does not let a run card hide another conversation's tracker", async () => {
  await render({ run: true }); await fire(false); expect(count("plan-dock")).toBe(1);
});
it("removes registration and disconnects on dismissal", async () => {
  await render(); await fire(false); await render({ mounted: false }); expect(Watch.all[0].disconnected).toBe(true); expect(count("plan-chip")).toBe(0);
});
it("uses the current conversation after switching away and back", async () => {
  await render(); await fire(false); await render({ sessionKey: "demo:other" }); expect(count("plan-chip")).toBe(0);
  await render(); expect(count("plan-dock")).toBe(1);
});
it("keeps the same observer across progress updates", async () => {
  await render(); await fire(false);
  await render({ card: { ...live, revision: 2, steps: live.steps!.map((s, i) => i === 1 ? { ...s, status: "completed" } : s) } });
  expect(Watch.all).toHaveLength(1); expect(Watch.all[0].disconnected).toBe(false);
  expect(container.querySelector('[data-testid="plan-chip"]')?.textContent).toBe("2 of 3");
});
it("starts folded on phones even when the preference is open", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(max-width: 760px)" }));
  await render(); await fire(false); expect(count("plan-dock")).toBe(0); expect(count("plan-chip")).toBe(1);
});
