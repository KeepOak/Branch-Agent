// @vitest-environment jsdom
// Settings › Devices & apps tiles: a tile is Connected only when a device is online now, and a list of devices
// reads each name once ("Branch and Branch Agent MCP"), never "Branch and Branch and Branch".
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { EverywhereTab } from "./everywhere";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineWith(nodes: unknown[], paired: unknown[]): WindowEngine {
  const answers: Record<string, unknown> = { "node.list": { nodes }, "device.pair.list": { paired }, "channels.status": {} };
  return { request: async (method: string) => answers[method] ?? {} } as unknown as WindowEngine;
}

async function render(engine: WindowEngine) {
  await act(async () => { root.render(<EverywhereTab engine={engine} openChannels={() => undefined} />); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  return host;
}

const tile = (container: HTMLElement, title: string) => container.querySelector<HTMLElement>(`[data-surface="${title}"]`);

describe("Devices & apps tiles", () => {
  it("reads Offline, not Connected, for a paired computer that is not online now", async () => {
    const container = await render(engineWith([], [{ displayName: "Office PC", platform: "win32", connected: false }]));
    expect(tile(container, "Windows")?.textContent).toContain("Offline");
    expect(tile(container, "Windows")?.textContent).not.toContain("Connected");
  });

  it("is Connected when the computer is online now", async () => {
    const container = await render(engineWith([{ displayName: "Office PC", platform: "win32", connected: true }], []));
    expect(tile(container, "Windows")?.textContent).toContain("Connected");
  });

  it("lists each Mac name once and counts the rest", async () => {
    const mac = (displayName: string) => ({ displayName, platform: "darwin", connected: true });
    const container = await render(engineWith([mac("Branch"), mac("Branch"), mac("Branch Agent MCP"), mac("Branch"), mac("Mini")], []));
    const line = tile(container, "Mac")?.querySelector("p")?.textContent ?? "";
    expect(line).toBe("Branch, Branch Agent MCP and 1 more");
    expect(line).not.toMatch(/Branch and Branch/);
  });
});
