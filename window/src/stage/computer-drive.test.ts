import { describe, expect, it } from "vitest";
import { computerActions } from "./computer-drive";
import { cuaKeys, keyPress } from "./drive-keys";
import { scrollAtPoint } from "./browser-input";

const frame = { id: "frame-7", width: 1280, height: 800 };
const aim = { displayFrameId: "frame-7", refWidth: 1280 };

describe("the computer route's actions", () => {
  it("aims pointer actions at the frame they were made on", () => {
    expect(computerActions({ kind: "click", x: 10, y: 20, button: "left" }, frame)).toEqual([{ action: "left_click", x: 10, y: 20, ...aim }]);
    expect(computerActions({ kind: "click", x: 10, y: 20, button: "right" }, frame)).toEqual([{ action: "right_click", x: 10, y: 20, ...aim }]);
    expect(computerActions({ kind: "move", x: 5, y: 6 }, frame)).toEqual([{ action: "mouse_move", x: 5, y: 6, ...aim }]);
    expect(computerActions({ kind: "drag", fromX: 1, fromY: 2, x: 30, y: 40 }, frame)).toEqual([{ action: "left_click_drag", fromX: 1, fromY: 2, x: 30, y: 40, ...aim }]);
  });

  it("turns a scroll into steps in each direction it moved", () => {
    expect(computerActions({ kind: "scroll", x: 50, y: 60, dx: 0, dy: 120 }, frame)).toEqual([{ action: "scroll", x: 50, y: 60, scrollDirection: "down", scrollAmount: 2, ...aim }]);
    expect(computerActions({ kind: "scroll", x: 50, y: 60, dx: -10, dy: -400 }, frame)).toEqual([
      { action: "scroll", x: 50, y: 60, scrollDirection: "up", scrollAmount: 8, ...aim },
      { action: "scroll", x: 50, y: 60, scrollDirection: "left", scrollAmount: 1, ...aim },
    ]);
  });

  it("types text and presses keys in the provider's spelling", () => {
    expect(computerActions({ kind: "type", text: "hé" }, frame)).toEqual([{ action: "type", text: "hé" }]);
    expect(computerActions({ kind: "key", key: "Enter" }, frame)).toEqual([{ action: "key", keys: "enter" }]);
    expect(computerActions({ kind: "key", key: "Control+Shift+t" }, frame)).toEqual([{ action: "key", keys: "ctrl+shift+t" }]);
    // A key it can't press by name goes as the character it types.
    expect(computerActions({ kind: "key", key: "1" }, frame)).toEqual([{ action: "type", text: "1" }]);
    expect(computerActions({ kind: "key", key: "Control+1" }, frame)).toEqual([]);
  });
});

describe("keys", () => {
  it("presses keys that are not text, and chords, and leaves text to arrive as text", () => {
    expect(keyPress({ key: "Enter" })).toBe("Enter");
    expect(keyPress({ key: "Escape" })).toBe("Escape");
    expect(keyPress({ key: "a" })).toBeNull();
    expect(keyPress({ key: "A", shiftKey: true })).toBeNull();
    expect(keyPress({ key: "c", metaKey: true })).toBe("Meta+c");
    expect(keyPress({ key: "T", ctrlKey: true, shiftKey: true })).toBe("Control+Shift+t");
    expect(keyPress({ key: "Control", ctrlKey: true })).toBeNull();
    expect(keyPress({ key: "ArrowLeft", isComposing: true })).toBeNull();
    // AltGr typing @ on a European layout is text, not a chord.
    expect(keyPress({ key: "@", ctrlKey: true, altKey: true })).toBeNull();
  });

  it("spells presses the way the computer provider reads them", () => {
    expect(cuaKeys("ArrowUp")).toBe("up");
    expect(cuaKeys("Meta+c")).toBe("cmd+c");
    expect(cuaKeys("F5")).toBe("f5");
    expect(cuaKeys("Control+;")).toBeNull();
  });
});

describe("scrolling the browser page", () => {
  it("scrolls the box under the point, or the page, by whole pixels", () => {
    const fn = scrollAtPoint(10.4, 20.6, 0, 99.5);
    expect(fn).toContain("document.elementFromPoint(10, 21)");
    expect(fn).toContain("scrollBy(0, 100)");
    expect(scrollAtPoint(Number.NaN, 0, 0, 0)).toContain("elementFromPoint(0, 0)");
  });
});
