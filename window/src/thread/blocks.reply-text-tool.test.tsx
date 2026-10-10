// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Reply } from "./blocks";
import { ThreadContext } from "./context";
import { stepLabel } from "./format";
import { stepFromTextToolCall } from "./text-tool-call";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

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

async function renderReply(text: string) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <ThreadContext.Provider value={{ name: "Builder", toast: () => undefined, running: false }}>
        <div className="thread">
          <Reply block={{ kind: "text", key: "live", text, streaming: false }} />
        </div>
      </ThreadContext.Provider>,
    ),
  );
  return host;
}

describe("Reply: text-channel tool calls", () => {
  it("shows a whole-reply tool-call JSON as the preview step line, not as JSON", async () => {
    const host = await renderReply(SPAWN_JSON);
    const step = host.querySelector('[data-testid="step"]') as HTMLElement;
    expect(step).not.toBeNull();
    expect(step.getAttribute("data-kind")).toBe("sessions_spawn");
    expect(step.querySelector(".step-label")?.textContent).toBe("Started a helper");
    expect(step.querySelector(".step-detail")?.textContent).toBe("model-smoke-test-2");
    expect(stepLabel(stepFromTextToolCall(SPAWN, "live"))).toBe("Started a helper");
    expect(host.querySelector(".reply-text")?.textContent).not.toContain('"name"');
    expect(host.querySelector(".reply-text")?.textContent).not.toContain(SPAWN_JSON);
  });

  it("shows a fenced tool-call JSON the same way", async () => {
    const host = await renderReply(`\`\`\`json\n${SPAWN_JSON}\n\`\`\``);
    expect(host.querySelector(".step-label")?.textContent).toBe("Started a helper");
    expect(host.querySelector(".step-detail")?.textContent).toBe("model-smoke-test-2");
    expect(host.querySelector(".reply-text")?.textContent).not.toContain('"sessions_spawn"');
  });

  it("renders JSON inside prose or a code block exactly as before", async () => {
    const prose = `Here is the call: ${SPAWN_JSON}`;
    const host = await renderReply(prose);
    expect(host.querySelector('[data-testid="step"]')).toBeNull();
    expect(host.querySelector(".reply-text")?.textContent).toContain(SPAWN_JSON);
  });
});
