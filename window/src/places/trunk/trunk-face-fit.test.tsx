import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TrunkFace } from "./TrunkFace";

describe("a Trunk's character stays inside its face panel", () => {
  it("wraps a character in a box the size of the panel, so the art cannot spill past it", () => {
    for (const size of [56, 96]) {
      const markup = renderToStaticMarkup(<TrunkFace name="Oak" look="ember" emoji="" size={size} />);
      expect(markup).toContain('class="tk-character-fit"');
      expect(markup).toContain(`width:${size}px;height:${size}px`);
    }
  });

  it("leaves the emoji and classic faces as they were", () => {
    const emoji = renderToStaticMarkup(<TrunkFace name="Oak" look="classic" emoji="🦊" size={56} />);
    expect(emoji).not.toContain("tk-character-fit");
    expect(emoji).toContain("tk-emoji-face");
  });
});
