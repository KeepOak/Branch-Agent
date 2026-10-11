import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHAT_MIN_BESIDE, STAGE_MIN_BESIDE, stageFit } from "./stage-fit";

const previewCss = readFileSync(join(import.meta.dirname, "../shell/preview.css"), "utf8");
const SIDEBAR = 292; // use-layout SIDE_DEFAULT

/** The conversation's width beside the stage, as the frame lays it out: window - sidebar - stage. */
const chatBeside = (windowWidth: number, sideWidth: number) => {
  const fit = stageFit(windowWidth, sideWidth);
  return fit.mode === "beside" ? windowWidth - sideWidth - fit.width : null;
};

describe("stageFit (DA-72)", () => {
  it("never squeezes the conversation below its floor beside the stage", () => {
    for (let w = 761; w <= 2560; w += 7) {
      for (const side of [0, 68, SIDEBAR, 420]) {
        const chat = chatBeside(w, side);
        if (chat !== null)
          expect(chat, `window ${w}, sidebar ${side}`).toBeGreaterThanOrEqual(CHAT_MIN_BESIDE);
      }
    }
  });

  it("opens as a sheet over the thread at the audited 1280 px window with the usual sidebar", () => {
    // Before: the stage took min(58vw, 100vw - 672px) = 608 px and left the chat 380 px.
    expect(stageFit(1280, SIDEBAR)).toEqual({ mode: "sheet" });
    expect(stageFit(1100, SIDEBAR)).toEqual({ mode: "sheet" });
    expect(stageFit(1440, SIDEBAR)).toEqual({ mode: "sheet" });
  });

  it("sits beside the conversation when the window has room for both", () => {
    const fit = stageFit(1600, SIDEBAR);
    expect(fit.mode).toBe("beside");
    if (fit.mode === "beside") {
      expect(fit.width).toBeGreaterThanOrEqual(STAGE_MIN_BESIDE);
      expect(1600 - SIDEBAR - fit.width).toBeGreaterThanOrEqual(CHAT_MIN_BESIDE);
    }
  });

  it("uses the room a hidden sidebar frees", () => {
    expect(stageFit(1280, 0)).toEqual({ mode: "beside", width: 680 });
  });

  it("lays the stage out from the fit, not from a width that assumes a 380 px chat", () => {
    expect(previewCss).not.toContain("100vw - 672px");
    expect(previewCss).toContain(
      ".frame.stage-beside .stage7 { left:auto; right:0; width:var(--stage-w);",
    );
    expect(previewCss).toContain(
      ".frame.stage-sheet .conversation-column > .computer-stage {position:relative;",
    );
  });

  it("keeps the stage to 58% of a wide window", () => {
    expect(stageFit(2560, SIDEBAR)).toEqual({ mode: "beside", width: Math.floor(2560 * 0.58) });
  });
});
