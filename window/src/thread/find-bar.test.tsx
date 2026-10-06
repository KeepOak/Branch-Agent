// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findRanges } from "./FindBar";

describe("find in this conversation", () => {
  it("finds phrases across inline Markdown but not across messages or controls", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="blk"><strong>Hartwell</strong><span> invoice</span><button>Hartwell invoice</button></div>'
      + '<div class="blk">Hartwell</div><div class="blk"> invoice</div>';
    document.body.append(root);
    const ranges = findRanges(root, "hartwell invoice");
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.toString()).toBe("Hartwell invoice");
    expect(ranges[0]?.startContainer.parentElement?.tagName).toBe("STRONG");
    expect(ranges[0]?.endContainer.parentElement?.tagName).toBe("SPAN");
    root.remove();
  });
});
