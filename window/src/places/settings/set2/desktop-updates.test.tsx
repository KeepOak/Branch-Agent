// @vitest-environment jsdom
// Private #1089: Settings › Updates never shows a stack, Error: prefix, JSON, status, id or method name.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FRIENDLY_ERROR } from "../../../connect/friendly-error";
import type { WindowEngine } from "../../../connect/engine";
import { UpdatesPage } from "./updates";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement; let root: Root;
const request = vi.fn(async () => ({}));
const engine: WindowEngine = { gatewayUrl: "ws://127.0.0.1:1", request: request as WindowEngine["request"], onEvent: () => () => {}, scopes: [], sessionKey: null };
const clean = { phase: "current" as const, currentVersion: "0.4.4", latestVersion: "0.4.4", pendingVersion: null, checkedAt: 123, error: null };
const desktopWindow = window as unknown as { branchDesktop?: unknown };
const RAW = /Error:|HTTP\s*500|\bupdate\.run\b|00000000-0000-4000-8000-000000000000|\n\s*at\s+|^\s*[{[]|ECONNREFUSED|logbook\.status/;
const DUMPS = [
  "Error: boom\n    at send (connect/session.ts:12:3)",
  '{"type":"error","error":{"message":"boom"}}',
  "HTTP 500: Internal Server Error",
  "unknown method: update.run",
  "run 00000000-0000-4000-8000-000000000000 failed",
  "connect ECONNREFUSED 127.0.0.1:18789",
];

function desktop(bridge: Record<string, unknown>) {
  desktopWindow.branchDesktop = { gatewayUrl: engine.gatewayUrl, componentUpdates: bridge };
}
async function show() {
  await act(async () => root.render(<UpdatesPage page="updates" title="Updates" level="regular" engine={engine} />));
}
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const checkNow = () => [...host.querySelectorAll("button")].find((b) => /Check now/.test(b.textContent ?? ""));
const pageText = () => host.textContent ?? "";

beforeEach(() => {
  localStorage.clear();
  // Status keeps the exact words at Technical, so this asserts the page itself ran friendlyError().
  localStorage.setItem("branch.level", "technical");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); delete desktopWindow.branchDesktop; localStorage.clear();
});

describe("Desktop updates never shows a raw engine error (Private #1089)", () => {
  it.each(DUMPS)("Check now throw becomes the helper sentence: %j", async (raw) => {
    desktop({
      status: async () => clean, check: async () => { throw new Error(raw); },
      stage: async () => clean, install: () => {},
    });
    await show();
    await flush();
    await act(async () => checkNow()?.click());
    await flush();
    expect(pageText()).not.toMatch(RAW);
    expect(pageText()).toContain(FRIENDLY_ERROR);
  });

  it("keeps already-plain copy from Check now", async () => {
    desktop({
      status: async () => clean, check: async () => { throw new Error("Couldn't reach the updater."); },
      stage: async () => clean, install: () => {},
    });
    await show();
    await flush();
    await act(async () => checkNow()?.click());
    await flush();
    expect(pageText()).toContain("Couldn't reach the updater.");
    expect(pageText()).not.toMatch(RAW);
  });

  it.each(DUMPS)("a status.error dump becomes the helper sentence: %j", async (raw) => {
    desktop({
      status: async () => clean,
      check: async () => ({ ...clean, error: raw }),
      stage: async () => clean, install: () => {},
    });
    await show();
    await flush();
    await act(async () => checkNow()?.click());
    await flush();
    expect(pageText()).not.toMatch(RAW);
    expect(pageText()).toContain(FRIENDLY_ERROR);
  });

  it.each(DUMPS)("a failed update event dump becomes the helper sentence: %j", async (raw) => {
    desktop({ status: async () => clean, check: async () => clean, stage: async () => clean, install: () => {} });
    await show();
    await flush();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("branch:update-state", { detail: { state: "failed", message: raw } }));
    });
    await flush();
    expect(pageText()).not.toMatch(RAW);
    expect(pageText()).toContain(FRIENDLY_ERROR);
  });
});
