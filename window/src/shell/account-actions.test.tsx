// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../connect/engine";
import { ModelsPage } from "../places/settings/set1/models";
import { ControlTower } from "./ControlTower";

vi.mock("../face/Face", () => ({ Face: () => <span /> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
beforeEach(() => { root = createRoot(document.body.appendChild(document.createElement("div"))); });
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });

function session(detect: Promise<unknown> = Promise.resolve({})) {
  const request = vi.fn(async (method: string) => {
    if (method === "models.authStatus") return { providers: [], providerCapabilities: [{ provider: "anthropic", apiKeySupported: true, loginOptions: [{ id: "anthropic/oauth", kind: "oauth", featured: true }] }] };
    if (method === "branch.setup.detect") return detect;
    if (method === "config.get") return { hash: "h", valid: true, config: {} };
    if (method === "agents.list") return { defaultId: "sprout", agents: [{ id: "sprout" }] };
    if (method === "wizard.next") return { done: false, step: { id: "login", type: "text", title: "Finish Claude sign-in", message: "Paste the sign-in code" } };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "sprout", scopes: [] } as unknown as WindowEngine, request };
}
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find((item) => item.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}

it("Add an account opens the add flow in Control tower without navigating", async () => {
  const { engine, request } = session();
  const navigate = vi.fn();
  window.addEventListener("branch:navigate-settings", navigate);
  try {
    await act(async () => root.render(<ControlTower engine={engine} rows={[]} needsCount={0} trunkName={(id) => id ?? ""} onOpen={() => undefined} onInbox={() => undefined} onClose={() => undefined} />));
    await click("Add an account");
    const dialog = document.querySelector('[data-testid="add-account"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Which service is the new account with?");
    expect(navigate).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("models.authStatus", { agentId: "sprout" });
    await click("Cancel");
    expect(document.querySelector('[data-testid="add-account"]')).toBeNull();
    expect(document.querySelector('[aria-label="Control tower"]')).not.toBeNull();
  } finally { window.removeEventListener("branch:navigate-settings", navigate); }
});

it("Sign in to Claude starts sign-in without opening the service list or waiting for detection", async () => {
  const { engine, request } = session(new Promise(() => undefined));
  await act(async () => root.render(<ModelsPage engine={engine} page="models" title="Models" level="regular" />));
  await click("Sign in to Claude");
  const dialog = document.querySelector('[data-testid="add-account"]');
  expect(dialog?.textContent).not.toContain("Which service is the new account with?");
  expect(dialog?.textContent).toContain("Finish Claude sign-in");
  expect(request).toHaveBeenCalledWith("models.authLogin", expect.objectContaining({ authChoice: "anthropic/oauth", agentId: "sprout" }));
  expect(request.mock.calls.filter(([method]) => method === "models.authLogin")).toHaveLength(1);
  await click("Back");
  expect(document.querySelector('[data-testid="add-account"]')?.textContent).toContain("Which service is the new account with?");
  expect(request.mock.calls.filter(([method]) => method === "models.authLogin")).toHaveLength(1);
});
