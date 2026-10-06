// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { findRanges } from "./FindBar";

describe("find in this conversation", () => {
  it("finds phrases across inline Markdown but not across messages or inside controls", () => {
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
  it("finds visible sent, queued, approval and question text without crossing rows", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div class="segment-page"><div class="segment-line">earlier</div><div class="segment-line">message</div></div>'
      + '<div class="queued-msg"><span>queued needle</span></div>'
      + '<div class="approval-card"><p>approve needle</p><button>Allow needle</button><textarea>typed needle</textarea></div>'
      + '<div class="msg"><div class="hover-bar"><span class="hb-time">time needle</span></div></div>'
      + '<div class="question-line">question needle</div>'
      + '<div class="user-message">sent needle</div>';
    document.body.append(root);
    for (const phrase of ["queued needle", "approve needle", "question needle", "sent needle"]) {
      expect(findRanges(root, phrase)).toHaveLength(1);
    }
    for (const phrase of ["allow needle", "typed needle", "time needle"]) {
      expect(findRanges(root, phrase)).toHaveLength(0);
    }
    expect(findRanges(root, "earliermessage")).toHaveLength(0);
    root.remove();
  });
});
