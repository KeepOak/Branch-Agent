// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { GatewayPage } from "./gateway";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

async function show(health: Record<string, unknown> | Error) {
  const engine: WindowEngine = {
    request: (async (method: string) => {
      if (method === "health") {
        if (health instanceof Error) throw health;
        return health;
      }
      return method === "config.get" ? { hash: "h", valid: true, config: {} } : {};
    }) as WindowEngine["request"],
    onEvent: () => () => undefined, sessionKey: "test", scopes: [],
  };
  await act(async () => root.render(<GatewayPage page="gateway" title="Gateway" level="regular" engine={engine} />));
}

describe("gateway health reporting", () => {
  it("keeps a timestamped failed result visibly unhealthy", async () => {
    await show({ ok: false, ts: Date.now(), durationMs: 12 });
    expect(host.textContent).toContain("The gateway needs attention");
    expect(host.textContent).not.toContain("The gateway is on");
    expect(host.querySelector(".gw-tl li")?.textContent).toContain("Failed in 12 ms");
    expect(host.querySelector(".gw-tl li.ok")).toBeNull();
  });
  it.each([{}, { ts: 123 }, { ok: "true", ts: 123 }])("does not infer health from an incomplete reply", async (health) => {
    await show(health);
    expect(host.textContent).toContain("Gateway health not reported");
    expect(host.textContent).not.toContain("The gateway is on");
    expect(host.querySelector(".gw-tl li.ok")).toBeNull();
  });
  it("shows a confirmed healthy result and successful timeline", async () => {
    await show({ ok: true, ts: Date.now() });
    expect(host.textContent).toContain("The gateway is on");
    expect(host.querySelector(".gw-tl li.ok")?.textContent).toContain("Passed");
  });
  it("preserves a transport error instead of claiming health", async () => {
    await show(new Error("Connection refused"));
    expect(host.textContent).toContain("The gateway isn’t answering");
    expect(host.textContent).toContain("Connection refused");
    expect(host.textContent).not.toContain("The gateway is on");
  });
  it("respects explicit disconnection while preserving running-only channel reports", async () => {
    await show({ ok: true, channelLabels: { telegram: "Telegram", discord: "Discord" }, channels: {
      telegram: { connected: false, running: true }, discord: { running: true },
    } });
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toContain("Discord keeps working when the window is closed");
    expect(status?.textContent).not.toContain("Telegram");
  });
});
