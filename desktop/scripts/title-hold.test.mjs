import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const { createTitleHold, TITLE_SETTLE_MS, TITLE_HOLD_MAX_MS } = await import(
  pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "title-hold.js"))
);

/** An Electron BrowserWindow as far as titles go: page titles change the native title unless prevented. */
class TitledWindow extends EventEmitter {
  constructor(title) { super(); this.title = title; this.shown = [title]; this.destroyed = false; }
  getTitle() { return this.title; }
  setTitle(title) { this.title = title; this.shown.push(title); }
  isDestroyed() { return this.destroyed; }
  /** The page set document.title. */
  page(title) {
    const event = { prevented: false, preventDefault() { this.prevented = true; } };
    this.emit("page-title-updated", event, title);
    if (!event.prevented) this.setTitle(title);
    return event.prevented;
  }
}

function fixture(...titles) {
  const windows = titles.map(title => new TitledWindow(title));
  const timers = new Set();
  let now = 0;
  const hold = createTitleHold({ windows: () => windows,
    setTimer: (run, ms) => { const timer = { at: now + ms, run }; timers.add(timer); return timer; },
    clearTimer: timer => { timers.delete(timer); } });
  const advance = ms => {
    now += ms;
    for (const timer of [...timers].sort((a, b) => a.at - b.at)) if (timer.at <= now && timers.delete(timer)) timer.run();
  };
  return { windows, hold, advance };
}

test("an update's reconnect never shows (Offline) or another Trunk in the window title", () => {
  const { windows: [main], hold, advance } = fixture("Birch — Branch");
  const release = hold.hold();
  // The old engine stops: the page goes offline, then reconnects with its lists still loading (the default Trunk).
  assert.equal(main.page("(Offline) Birch — Branch"), true);
  release(); // the new engine serves
  assert.equal(main.page("(Offline) Birch — Branch"), true);
  assert.equal(main.page("Sapling — Branch"), true);
  advance(TITLE_SETTLE_MS - 1);
  assert.equal(main.page("Birch — Branch"), true);
  // The lists finish loading: the name flips once more, then stays.
  assert.equal(main.page("Sapling — Branch"), true);
  assert.equal(main.page("Birch — Branch"), true);
  advance(TITLE_SETTLE_MS - 1);
  assert.equal(hold.holding(main), true);
  advance(1);
  assert.deepEqual(main.shown, ["Birch — Branch"], "the native title flipped during the update");
  assert.equal(hold.holding(main), false);
  // After the update the title follows the page again.
  assert.equal(main.page("(2) Birch — Branch"), false);
  advance(TITLE_HOLD_MAX_MS);
  assert.deepEqual(main.shown, ["Birch — Branch", "(2) Birch — Branch"]);
});

test("a title the page really moved to shows once it settles, and offline is held until it reconnects", () => {
  const { windows: [main, popOut], hold, advance } = fixture("Birch — Branch", "Plans — Branch");
  const release = hold.hold();
  release();
  // After a handoff the window moves to the new engine once the swap is over: it goes offline after the release.
  assert.equal(popOut.page("(Offline) Plans — Branch"), true);
  // The owner opened another conversation while the engine restarted.
  main.page("Oak — Branch");
  advance(TITLE_SETTLE_MS);
  assert.deepEqual(main.shown, ["Birch — Branch", "Oak — Branch"]);
  // A pop-out still offline keeps its title until the page is connected, or the cap (counted from the release).
  advance(TITLE_HOLD_MAX_MS - TITLE_SETTLE_MS - 1);
  assert.deepEqual(popOut.shown, ["Plans — Branch"]);
  advance(1);
  assert.deepEqual(popOut.shown, ["Plans — Branch", "(Offline) Plans — Branch"], "a window that never reconnects says so after the cap");
  assert.equal(hold.holding(popOut), false);
});

test("a release with no title change, a second release, and a closed window are all quiet", () => {
  const { windows: [main, closed], hold, advance } = fixture("Birch — Branch", "Notes — Branch");
  const release = hold.hold();
  closed.page("(Offline) Notes — Branch");
  closed.destroyed = true;
  release(); release();
  advance(TITLE_HOLD_MAX_MS);
  assert.equal(hold.holding(main), false);
  assert.equal(hold.holding(closed), false);
  assert.deepEqual(main.shown, ["Birch — Branch"]);
  assert.deepEqual(closed.shown, ["Notes — Branch"]);
  assert.equal(main.listenerCount("page-title-updated"), 0);
});
