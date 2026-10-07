// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { startersFor } from "./EmptyState";

afterEach(() => document.body.replaceChildren());

describe("empty conversation chip sizing", () => {
  it("wraps starter rows and long chips within the pane width", () => {
    const style = document.body.appendChild(document.createElement("style"));
    style.textContent = readFileSync("src/thread/empty.css", "utf8");
    const thread = document.body.appendChild(document.createElement("div"));
    thread.className = "thread";
    thread.style.width = "280px";
    const starters = thread.appendChild(document.createElement("div"));
    starters.className = "starters";
    for (const text of startersFor("Money & receipts", false)) {
      const chip = starters.appendChild(document.createElement("button"));
      chip.className = "chipb";
      chip.textContent = text;
    }
    expect(getComputedStyle(starters).flexWrap).toBe("wrap");
    expect(getComputedStyle(starters).maxWidth).toBe("100%");
    expect(getComputedStyle(starters).overflowX).not.toBe("auto");
    for (const chip of starters.children) {
      const computed = getComputedStyle(chip);
      expect(computed.maxWidth).toBe("100%");
      expect(computed.whiteSpace).toBe("normal");
      expect(computed.overflowWrap).toBe("anywhere");
      expect(computed.height).not.toBe("34px");
      expect(computed.minHeight).toBe("34px");
    }
  });
});
