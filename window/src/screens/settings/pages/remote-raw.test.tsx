// @vitest-environment jsdom
// Private #1089: Settings › Remote access › Lately put the engine's error after "The gateway isn't answering.". The
// sentence is plain now and the engine's words wait under Details.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { Lately } from "./remote-live";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; document.body.innerHTML = ""; });

it("says the gateway isn't answering without the engine's raw words", async () => {
  const raw = "Error: connect ECONNREFUSED 127.0.0.1:19031 at TCPConnectWrap.afterConnect (node:net:1555:16)";
  const request = vi.fn(async (method: string) => { if (method === "health") throw new Error(raw); return {}; });
  const engine = { request, onEvent: () => () => {}, sessionKey: null, scopes: ["operator.admin"], features: { methods: ["health", "system.info", "presence.query"], events: [] } } as unknown as WindowEngine;
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root!.render(<Lately engine={engine} row={{ label: "Lately" } as never} />));
  await act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
  const seen = host.cloneNode(true) as HTMLElement;
  for (const d of seen.querySelectorAll("details:not([open])")) for (const c of [...d.children]) if (c.tagName !== "SUMMARY") c.remove();
  expect(seen.textContent).toContain("The gateway isn’t answering. Try again in a moment.");
  expect(seen.textContent).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|Error:|:\d+:\d+|node:net/);
  expect(host.querySelector("details code")?.textContent).toBe(raw);
});
