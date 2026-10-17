// @vitest-environment jsdom
// Private #1102 (Branch B-053): on Linux (or a Mac), Settings never names WSL, a Windows-only part. The Remove Branch
// panel and the terminal row's help say it only on Windows.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "./engine";
import { clientOs } from "./client-os";
import { UpdatesBlock } from "../places/settings/set2/updates";
import { REMOTE_ROWS, terminalHelp } from "../screens/settings/pages/remote";

let host: HTMLDivElement; let root: Root;
const engine: WindowEngine = { gatewayUrl: "ws://127.0.0.1:1", request: vi.fn(async () => ({})) as WindowEngine["request"], onEvent: () => () => {}, scopes: [], sessionKey: null };
async function showRemove(platform: string) {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  await act(async () => root.render(<UpdatesBlock page="updates" title="Updates" level="regular" engine={engine} part="remove" />));
}
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it("reads this window's OS from navigator.platform", () => {
  expect(clientOs("Win32")).toBe("windows");
  expect(clientOs("MacIntel")).toBe("mac");
  expect(clientOs("Linux x86_64")).toBe("linux");
  expect(clientOs("")).toBe("other");
});

it("the Remove Branch panel names WSL on Windows only", async () => {
  await showRemove("Linux x86_64");
  expect(host.textContent).toContain("Models on this computer");
  expect(host.textContent).not.toMatch(/WSL/);
  await showRemove("MacIntel");
  expect(host.textContent).not.toMatch(/WSL/);
  await showRemove("Win32");
  expect(host.textContent).toContain("Branch’s Linux system (WSL)");
});

it("the terminal row's help says WSL on Windows only", () => {
  expect(terminalHelp("linux")).toBe("Opens a terminal on the Gateway’s computer: this one, or another one over SSH.");
  expect(terminalHelp("mac")).not.toMatch(/WSL/);
  expect(terminalHelp("windows")).toContain("in WSL on this PC");
  // jsdom reports no platform, so this window is not Windows and the row's help has no WSL.
  const row = REMOTE_ROWS.find((r) => r.id === "remote.doing.terminal");
  expect(row?.help).toBe("Opens a terminal on the Gateway’s computer: this one, or another one over SSH.");
});
