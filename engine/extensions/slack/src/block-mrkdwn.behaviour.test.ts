// Branch behavior test for CHAT-APPS-0157; the atlas records no upstream test files for this row.
import { describe, expect, it } from "vitest";
import { buildSlackBlocksFallbackText } from "./blocks-fallback.js";
import { buildSlackPresentationBlocks } from "./blocks-render.js";
import { normalizeSlackOutboundText } from "./format.js";

describe("Slack Block Kit and mrkdwn delivery", () => {
  it("keeps formatting and accessible fallback without activating mass mentions", () => {
    const text = normalizeSlackOutboundText("**Deploy** <!channel> <!here> <@U123> & ready");
    const blocks = buildSlackPresentationBlocks({
      title: "Deploy status",
      blocks: [
        { type: "text", text },
        { type: "buttons", buttons: [{ label: "Approve", value: "approve" }] },
      ],
    });

    expect(blocks).toMatchObject([
      { type: "header", text: { text: "Deploy status" } },
      {
        type: "section",
        text: { text: "*Deploy* &lt;!channel&gt; &lt;!here&gt; <@U123> &amp; ready" },
      },
      { type: "actions", elements: [{ text: { text: "Approve" } }] },
    ]);
    const fallback = buildSlackBlocksFallbackText(blocks);
    expect(fallback).toBe("Deploy status");
    expect(fallback).not.toContain("<!channel>");
  });
});
