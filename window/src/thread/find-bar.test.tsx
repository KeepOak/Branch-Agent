// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findRanges } from "./FindBar";

describe("find in this conversation", () => {
  it("finds phrases across inline Markdown but not across messages", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="blk"><strong>Hartwell</strong><span> invoice</span><button>Hartwell invoice</button></div>'
      + '<div class="blk">Hartwell</div><div class="blk"> invoice</div>';
    document.body.append(root);
    const ranges = findRanges(root, "hartwell invoice");
    expect(ranges).toHaveLength(2);
    expect(ranges[0]?.toString()).toBe("Hartwell invoice");
    expect(ranges[0]?.startContainer.parentElement?.tagName).toBe("STRONG");
    expect(ranges[0]?.endContainer.parentElement?.tagName).toBe("SPAN");
    expect(ranges[1]?.startContainer.parentElement?.tagName).toBe("BUTTON");
    root.remove();
  });
  it("finds visible sent, queued, approval and question text without crossing rows", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="segment-page"><div class="segment-line">earlier</div><div class="segment-line">message</div></div>'
      + '<div class="queued-msg"><span>queued needle</span></div>'
      + '<div class="approval-card"><button>approve needle</button></div>'
      + '<div class="question-line">question needle</div>'
      + '<div class="user-message">sent needle</div>';
    document.body.append(root);
    for (const phrase of ["queued needle", "approve needle", "question needle", "sent needle"]) {
      expect(findRanges(root, phrase)).toHaveLength(1);
    }
    expect(findRanges(root, "earliermessage")).toHaveLength(0);
    root.remove();
  });
});
