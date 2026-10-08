// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider } from "../kit";
import { SLATE } from "./appearance-look";
import { LightDarkSec } from "./appearance-top";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("mirrors the current session when a reused engine switches conversations or has none", async () => {
  const request = vi.fn(async (_method: string, params: { sessionKey?: string }) => ({ messages: [{ role: "user", content: `Words from ${params.sessionKey}` }] }));
  const engine = { request, sessionKey: "first" } as unknown as WindowEngine;
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  const render = () => act(async () => root.render(<KitProvider level={0} scope={null} report={{ saving: vi.fn(), saved: vi.fn(), failed: vi.fn() }}><LightDarkSec engine={engine} pair={SLATE} trunk="Birch" profile={false} /></KitProvider>));
  try {
    await render();
    expect(host.textContent).toContain("Words from first");
    engine.sessionKey = "second";
    await render();
    expect(host.textContent).toContain("Words from second");
    expect(host.textContent).not.toContain("Words from first");
    engine.sessionKey = null;
    await render();
    expect(host.textContent).not.toContain("Words from second");
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
