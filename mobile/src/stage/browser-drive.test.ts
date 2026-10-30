import { browserAct } from "./browser-drive";
import { scrollAtPoint } from "./browser-input";

describe("the browser route's actions", () => {
  it("sends clicks, typing, keys and scrolls through /act, and drops move and drag", () => {
    expect(browserAct({ kind: "click", x: 10, y: 20, button: "left" })).toEqual({ kind: "clickCoords", x: 10, y: 20 });
    expect(browserAct({ kind: "click", x: 10, y: 20, button: "right" })).toEqual({ kind: "clickCoords", x: 10, y: 20, button: "right" });
    expect(browserAct({ kind: "type", text: "hi" })).toEqual({ kind: "insertText", text: "hi" });
    expect(browserAct({ kind: "key", key: "Enter" })).toEqual({ kind: "press", key: "Enter" });
    expect(browserAct({ kind: "scroll", x: 4, y: 5, dx: 0, dy: 40 })).toEqual({ kind: "evaluate", fn: scrollAtPoint(4, 5, 0, 40) });
    expect(browserAct({ kind: "move", x: 1, y: 2 })).toBeNull();
    expect(browserAct({ kind: "drag", fromX: 1, fromY: 2, x: 3, y: 4 })).toBeNull();
  });
});
