// @vitest-environment jsdom
// Private #1089: Settings › Remote access › Lately put the engine's error after "The gateway isn't answering.". The line
// reads through plainError() now, and none of the engine's words (ECONNREFUSED, an address, a stack) is rendered, not even
// behind a Details click.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { Lately } from "./remote-live";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

async function lately(raw: string) {
  const request = vi.fn(async (method: string) => { if (method === "health") throw new Error(raw); return {}; });
  const engine = { request, onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"], features: { methods: ["health", "system.info", "presence.query"], events: [] } } as unknown as WindowEngine;
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<Lately engine={engine} row={{ label: "Lately" } as never} />));
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
  return host;
}

it("says the gateway isn't answering without the engine's raw words", async () => {
  const host = await lately("Error: connect ECONNREFUSED 127.0.0.1:19031 at TCPConnectWrap.afterConnect (node:net:1555:16)");
  expect(host.textContent).toContain("The gateway isn’t answering. Branch can’t reach its engine right now.");
  expect(host.textContent).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|19031|Error:|:\d+:\d+|node:net|TCPConnectWrap/);
  expect(host.querySelector("details")).toBeNull();
});

it("says a failure nothing more specific matches as the line and Try again, with no code or id", async () => {
  const host = await lately("UNAVAILABLE: health probe failed for agent:main:main (request id 3f9a0c2be81d4a7f9c1e)");
  expect(host.textContent).toContain("The gateway isn’t answering. Try again in a moment.");
  expect(host.textContent).not.toMatch(/UNAVAILABLE|health probe|agent:main|request id|3f9a0c2be81d4a7f9c1e/);
  expect(host.querySelector("details")).toBeNull();
});
