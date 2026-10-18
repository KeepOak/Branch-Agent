// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import type { SlotControlProps } from "../slots";
import { AddAccount } from "./accounts-live";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  sessionStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const providersShown = () => [...document.querySelectorAll('[data-testid="add-account"] .aa-grp button.prov > b')]
  .map((tile) => tile.textContent);

it("waits for status before showing the complete provider list, without a partial list growing", async () => {
  let resolveStatus!: (value: unknown) => void;
  const status = new Promise<unknown>((resolve) => { resolveStatus = resolve; });
  const request = vi.fn(async (method: string) => {
    if (method === "models.authStatus") return status;
    if (method === "branch.setup.detect") return {
      prepareOptions: [{ id: "ollama", brandId: "ollama", label: "Ollama" }],
    };
    return {};
  });
  const engine = {
    request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: [],
    features: { methods: ["models.authStatus", "models.authLogin", "branch.setup.detect"], events: [] },
  } as unknown as WindowEngine;
  const row = {} as SlotControlProps["row"];
  await act(async () => root.render(<AddAccount engine={engine} row={row} />));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(request).toHaveBeenCalledWith("branch.setup.detect", expect.anything());
  expect(document.querySelector('[data-testid="add-account-loading"]')).not.toBeNull();
  expect(providersShown()).toEqual([]);

  await act(async () => resolveStatus({
    providers: [],
    providerCapabilities: [
      { provider: "anthropic", apiKeySupported: true, loginOptions: [{ id: "claude-oauth", kind: "oauth", groupLabel: "Claude" }] },
      { provider: "google", apiKeySupported: true, loginOptions: [{ id: "google-oauth", kind: "oauth" }] },
    ],
  }));
  expect(document.querySelector('[data-testid="add-account-loading"]')).toBeNull();
  const complete = providersShown();
  expect(complete).toEqual(expect.arrayContaining(["Claude", "Google Gemini", "Ollama"]));

  await act(async () => root.render(<AddAccount engine={engine} row={row} />));
  expect(providersShown()).toEqual(complete);
  expect(request.mock.calls.filter(([method]) => method === "models.authStatus")).toHaveLength(1);
});
