// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { useWizard, type WizardStart } from "./use-wizard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ engine, start, seen }: { engine: WindowEngine; start: WizardStart; seen: (phase: string) => void }) {
  const w = useWizard(engine, start);
  seen(w.view.phase === "step" ? `step:${w.view.step.id}` : w.view.phase);
  return null;
}

async function run(replies: unknown[]) {
  const request = vi.fn(async (method: string) => (method === "wizard.next" ? replies.shift() : {}));
  const engine = { request } as unknown as WindowEngine;
  const phases: string[] = [];
  const start: WizardStart = {
    method: "models.authLogin",
    params: { authChoice: "anthropic/setup-token", profileLabel: "claude-2" },
    secret: { value: "pasted-value", match: (s) => /setup-token/i.test(s.message ?? "") },
  };
  const root = createRoot(document.createElement("div"));
  await act(async () => { root.render(<Probe engine={engine} start={start} seen={(p) => phases.push(p)} />); });
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
  act(() => root.unmount());
  return { calls: request.mock.calls.map((c) => c as unknown[]), phases };
}

const paste = { done: false, step: { id: "t1", type: "text", message: "Paste Anthropic setup-token" } };

describe("useWizard's pasted secret", () => {
  it("keeps the secret out of the start request and answers the matching step once", async () => {
    const { calls, phases } = await run([paste, { done: true, status: "done" }]);
    expect(calls[0][0]).toBe("models.authLogin");
    expect(JSON.stringify(calls[0][1])).not.toContain("pasted-value");
    const answers = calls.filter((c) => JSON.stringify(c[1]).includes("pasted-value"));
    expect(answers).toEqual([["wizard.next", expect.objectContaining({ answer: { stepId: "t1", value: "pasted-value" } })]]);
    expect(phases.at(-1)).toBe("done");
  });

  it("leaves a step the engine shows again for the owner", async () => {
    const { calls, phases } = await run([paste, paste]);
    expect(calls.filter((c) => JSON.stringify(c[1]).includes("pasted-value"))).toHaveLength(1);
    expect(phases.at(-1)).toBe("step:t1");
  });
});
