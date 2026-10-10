// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { stepFromTextToolCall } from "../thread/text-tool-call";
import { ReplayDialog, replayLines } from "./Replay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SPAWN = {
  name: "sessions_spawn",
  arguments: {
    visible: true,
    title: "model-smoke-test-2",
    sessionKey: "agent:<id>:model-smoke-test-2",
    message: "Starting new session for model smoke test",
  },
};
const SPAWN_JSON = JSON.stringify(SPAWN);

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

async function renderReplay(text: string) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ReplayDialog
        history={[{ kind: "text", key: "r1", text, streaming: false }]}
        trunkName="Scout"
        onClose={() => undefined}
      />,
    ),
  );
  return host;
}

describe("replayLines: text-channel tool calls", () => {
  it("shows a whole-reply tool-call JSON as the preview step words, never as JSON", () => {
    const lines = replayLines([{ kind: "text", key: "r1", text: SPAWN_JSON, streaming: false }], "Scout");
    expect(lines).toEqual([{ who: "Scout", text: "Started a helper · model-smoke-test-2" }]);
    expect(JSON.stringify(lines)).not.toContain('"name"');
    expect(JSON.stringify(lines)).not.toContain("sessions_spawn");
  });

  it("shows a fenced tool-call JSON the same way, and a converted step the same way", () => {
    expect(replayLines([{ kind: "text", key: "r1", text: `\`\`\`json\n${SPAWN_JSON}\n\`\`\``, streaming: false }], "Scout")).toEqual([
      { who: "Scout", text: "Started a helper · model-smoke-test-2" },
    ]);
    expect(replayLines([stepFromTextToolCall(SPAWN, "h:1:0")], "Scout")).toEqual([
      { who: "Scout", text: "Started a helper · model-smoke-test-2" },
    ]);
  });

  it("leaves normal text and JSON inside prose exactly as before", () => {
    expect(
      replayLines(
        [
          { kind: "user", key: "1", text: "hi" },
          { kind: "notice", key: "2", text: "x" },
          { kind: "text", key: "3", text: "hello", streaming: false },
        ],
        "Fern",
      ),
    ).toEqual([
      { who: "You", text: "hi" },
      { who: "Fern", text: "hello" },
    ]);
    const prose = `Here is the call: ${SPAWN_JSON}`;
    expect(replayLines([{ kind: "text", key: "r1", text: prose, streaming: false }], "Scout")).toEqual([
      { who: "Scout", text: prose },
    ]);
    expect(replayLines([{ kind: "text", key: "r1", text: `Use this:\n\n\`\`\`json\n${SPAWN_JSON}\n\`\`\`\n`, streaming: false }], "Scout")[0]?.text).toContain(SPAWN_JSON);
  });
});

describe("Replay this conversation", () => {
  it("renders tool-call text as plain words and leaves a normal reply unchanged", async () => {
    const host = await renderReplay(SPAWN_JSON);
    expect(host.textContent).toContain("Started a helper · model-smoke-test-2");
    expect(host.textContent).toContain("1 of 1");
    expect(host.textContent).not.toContain('"sessions_spawn"');
    expect(host.textContent).not.toContain(SPAWN_JSON);
    await act(async () => root!.unmount());
    root = undefined;
    const next = await renderReplay("Dana replied about the August report.");
    expect(next.textContent).toContain("Dana replied about the August report.");
    expect(next.textContent).not.toContain("Started a helper");
  });
});
