import { describe, expect, it } from "vitest";
import { telegramChannelConfigUiHints } from "./config-ui-hints.js";

describe("Telegram tool-progress configuration help", () => {
  it("distinguishes preview modes from the default progress mode", () => {
    const help = telegramChannelConfigUiHints["streaming.preview.toolProgress"].help;

    expect(help).toContain("partial and block");
    expect(help).toContain("streaming.progress.toolProgress");
  });

  it("explains the progress opt-in without making verbosity an override", () => {
    const help = telegramChannelConfigUiHints["streaming.progress.toolProgress"].help;

    expect(help).toContain("default: false");
    expect(help).toContain("/verbose full does not enable these rows");
    expect(help).toContain("Explicit false keeps them hidden");
    expect(help).toContain("Terminal task errors remain visible");
  });
});
