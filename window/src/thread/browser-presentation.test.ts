import { describe, expect, it } from "vitest";
import { historyToBlocks } from "./history";
import { projectRun } from "./model";
import { readBrowserPresentation } from "./browser-presentation";
const tab = {
  target: "node",
  node: "node-a",
  profile: "work",
  targetId: "tab-one",
  title: "Report",
  url: "https://example.test/report",
};
const result = {
  content: [{ type: "text", text: "Opened the report" }],
  details: { browserTab: tab },
};
const history = [
  {
    role: "assistant",
    content: [{ type: "toolCall", id: "call-one", name: "browser", arguments: { action: "open" } }],
    stopReason: "toolUse",
  },
  { role: "toolResult", toolCallId: "call-one", toolName: "browser", ...result },
];
describe("browser tab projection", () => {
  it("retains the full route and call revision after reload", () => {
    const step = historyToBlocks(history, [], "agent:scout:one", null).find(
      (b) => b.kind === "step",
    );
    expect(step).toMatchObject({
      browser: {
        tab: { target: "node", node: "node-a", profile: "work", targetId: "tab-one" },
        revision: "call-one",
        title: "Report",
        url: tab.url,
      },
    });
  });
  it("retains the same identity in the live result", () => {
    const blocks = projectRun(
      [
        {
          runId: "run-one",
          seq: 1,
          stream: "tool",
          ts: 1,
          data: { phase: "start", toolCallId: "call-one", name: "browser", args: {} },
        },
        {
          runId: "run-one",
          seq: 2,
          stream: "tool",
          ts: 2,
          data: { phase: "result", toolCallId: "call-one", name: "browser", result },
        },
      ],
      new Map(),
    );
    expect(blocks[0]).toMatchObject({
      browser: {
        tab: { node: "node-a", profile: "work", targetId: "tab-one" },
        revision: "call-one",
      },
    });
  });
  it("does not guess missing routing fields or admit metadata from other tools", () => {
    expect(
      readBrowserPresentation(
        { details: { browserTab: { targetId: "tab-one" } } },
        "browser",
        "call-one",
      ),
    ).toBeUndefined();
    expect(readBrowserPresentation(result, "exec", "call-one")).toBeUndefined();
    expect(
      readBrowserPresentation(
        { details: { browserTab: { ...tab, target: "host" } } },
        "browser",
        "call-one",
      ),
    ).toBeUndefined();
  });
  it("does not attach failed browser results to a live viewer", () => {
    const step = historyToBlocks(
      [history[0], { ...history[1], isError: true }],
      [],
      "agent:scout:one",
      null,
    ).find((b) => b.kind === "step");
    expect(step?.kind === "step" && step.browser).toBeUndefined();
  });
});
