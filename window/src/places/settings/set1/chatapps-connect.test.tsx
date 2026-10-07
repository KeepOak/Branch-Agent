// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { useChannelWizard } from "./chatapps-connect";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
describe("channel wizard request state", () => {
  it("submits one answer before rerender and accepts the next step afterward", async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    const request = vi.fn(async (method: string) => method === "wizard.start" ? { sessionId: "w1", done: false, step: { id: "one", type: "text", title: "Token" } } : pending);
    const engine = { request } as unknown as WindowEngine;
    let wizard!: ReturnType<typeof useChannelWizard>;
    function Probe() { wizard = useChannelWizard(engine, "telegram"); return <span>{wizard.busy ? "Waiting" : "Ready"}</span>; }
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Probe />));
      await act(async () => { wizard.answer("token"); wizard.answer("token"); });
      expect(request.mock.calls.filter(([method]) => method === "wizard.next")).toHaveLength(1);
      expect(request).toHaveBeenCalledWith("wizard.next", { sessionId: "w1", answer: { stepId: "one", value: "token" } });
      expect(host.textContent).toBe("Waiting");
      await act(async () => finish({ done: false, step: { id: "two", type: "text", title: "Name" } }));
      expect(host.textContent).toBe("Ready");
      await act(async () => wizard.answer("name"));
      expect(request.mock.calls.filter(([method]) => method === "wizard.next")).toHaveLength(2);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });
});
