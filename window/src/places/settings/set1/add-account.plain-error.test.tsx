// @vitest-environment jsdom
// Add an account: detect and key-save failures read as one plain sentence at Regular, exact words at Advanced.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { AddAccountDialog } from "./add-account";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|unknown method|logbook\.status/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:18789";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";
const CAPS = [
  { provider: "anthropic", apiKeySupported: true, loginOptions: [{ id: "claude-oauth", kind: "oauth", groupLabel: "Claude" }] },
  { provider: "google-gemini", apiKeySupported: true },
];

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

function engineOf(request: (method: string) => Promise<unknown>) {
  return { request, onEvent: () => () => undefined, sessionKey: "s", agentId: "main", scopes: [] } as unknown as WindowEngine;
}

const settle = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };

describe("Add an account never shows a raw engine error at Regular", () => {
  it("names a failed detect in a plain sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "branch.setup.detect") throw new Error(ENGINE);
      return {};
    });
    await act(async () => root.render(
      <AddAccountDialog engine={engineOf(request)} start={{}} caps={CAPS} providers={[]} agent={{ agentId: "main" }} onClose={() => undefined} />,
    ));
    await settle();
    const line = host.querySelector("[role='status']")?.textContent ?? "";
    expect(line).toBe(REACH);
    expect(line).not.toMatch(RAW);
  });

  it("names a failed key save in a plain sentence", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "branch.setup.detect") return {};
      if (method === "models.authStatus") return { providers: [] };
      if (method === "models.authSetApiKey") throw new Error("unknown method: logbook.status");
      return {};
    });
    await act(async () => root.render(
      <AddAccountDialog engine={engineOf(request)} start={{}} caps={CAPS} providers={[]} agent={{ agentId: "main" }} onClose={() => undefined} />,
    ));
    await settle();
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>(".dlg .prov")].find((b) => b.textContent?.includes("Google Gemini"))!.click());
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Key"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "sk-test");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Add key")!.click());
    await settle();
    const alert = host.querySelector("[role='alert']")?.textContent ?? "";
    expect(alert).toBe("This part of Branch isn’t ready on this computer yet. Update Branch, then try again.");
    expect(alert).not.toMatch(RAW);
  });

  it("keeps the exact words at Advanced", async () => {
    localStorage.setItem("branch.level", "advanced");
    const request = vi.fn(async (method: string) => {
      if (method === "branch.setup.detect") throw new Error(ENGINE);
      return {};
    });
    await act(async () => root.render(
      <AddAccountDialog engine={engineOf(request)} start={{}} caps={CAPS} providers={[]} agent={{ agentId: "main" }} onClose={() => undefined} />,
    ));
    await settle();
    expect(host.querySelector("[role='status']")?.textContent).toBe(ENGINE);
  });
});
