// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { readSavedTargets, readTarget } from "../setup/pre-connect-state";

vi.mock("../connect/session", () => ({
  SaplingSession: class {
    snapshot = { status: { phase: "connected", hello: {} } };
    getSnapshot = () => this.snapshot;
    subscribe = () => () => {};
    start(): void {}
    stop(): void {}
    reconnectNow(): void {}
    handoff(): void {}
  },
}));
vi.mock("./WindowShell", () => ({
  WindowShell: ({ url }: { url: string }) => <div data-testid="window-shell">{url}</div>,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOME = "ws://127.0.0.1:19621";
let root: Root | undefined;

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  delete (window as { branchDesktop?: unknown }).branchDesktop;
});

async function mountConnected() {
  (window as { branchDesktop?: unknown }).branchDesktop = { gatewayUrl: HOME, gatewayToken: "k" };
  const { App } = await import("../App");
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(<App />));
  return host;
}

async function typeAddr(host: HTMLElement, value: string) {
  const field = host.querySelector<HTMLInputElement>('[aria-label="Address or setup code"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function setupCode(payload: Record<string, unknown>): string {
  return btoa(JSON.stringify(payload));
}

it("dispatching connect-elsewhere while connected shows the dialog and keeps the window mounted; Cancel and Escape close it with no target change", async () => {
  const host = await mountConnected();
  expect(host.querySelector("[data-testid=window-shell]")?.textContent).toBe(HOME);
  await act(async () => window.dispatchEvent(new CustomEvent("branch:connect-elsewhere")));
  expect(host.querySelector("[data-testid=connect-elsewhere]")).not.toBeNull();
  expect(host.querySelector("[data-testid=window-shell]")).not.toBeNull();
  expect(host.querySelector("[data-testid=setup]")).toBeNull();
  expect(host.textContent).toContain("Your current connection stays until you save.");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Connect by"] button:disabled')?.textContent).toBe("SSH tunnel");
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Connect by"] button:disabled')?.title).toBe("Starts an SSH tunnel from the Branch app on your computer.");
  expect([...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Test")?.title).toBe("Tests the connection from the Branch app on your computer.");
  expect([...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Use a QR image…")?.title).toBe("Reads the code from a picture in the Branch app on your computer.");
  await act(async () => host.querySelector<HTMLButtonElement>(".dlg-f .ghost")!.click());
  expect(host.querySelector("[data-testid=connect-elsewhere]")).toBeNull();
  expect(host.querySelector("[data-testid=window-shell]")?.textContent).toBe(HOME);
  expect(readTarget()).toBeNull();
  expect(readSavedTargets()).toEqual([]);

  await act(async () => window.dispatchEvent(new CustomEvent("branch:connect-elsewhere")));
  await act(async () => {
    host.querySelector("[data-testid=connect-elsewhere]")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(host.querySelector("[data-testid=connect-elsewhere]")).toBeNull();
  expect(host.querySelector("[data-testid=window-shell]")?.textContent).toBe(HOME);
  expect(readTarget()).toBeNull();
  expect(readSavedTargets()).toEqual([]);
});

it("Save with wss://example.test saves the target and switches; an expired or unreadable setup code shows the preview error and saves nothing", async () => {
  const host = await mountConnected();
  await act(async () => window.dispatchEvent(new CustomEvent("branch:connect-elsewhere")));
  await typeAddr(host, setupCode({ url: "wss://expired.test", exp: 1 }));
  await act(async () => host.querySelector<HTMLButtonElement>(".dlg-f .pri")!.click());
  expect(host.querySelector("[role=alert]")?.textContent).toBe("This setup code has expired. Ask for a new one.");
  expect(readTarget()).toBeNull();
  expect(readSavedTargets()).toEqual([]);
  expect(host.querySelector("[data-testid=window-shell]")?.textContent).toBe(HOME);

  await typeAddr(host, "this-is-not-a-setup-code-branch-can-read");
  await act(async () => host.querySelector<HTMLButtonElement>(".dlg-f .pri")!.click());
  expect(host.querySelector("[role=alert]")?.textContent).toBe("This isn’t a setup code Branch can read.");
  expect(readTarget()).toBeNull();
  expect(readSavedTargets()).toEqual([]);
  expect(host.querySelector("[data-testid=window-shell]")?.textContent).toBe(HOME);

  await typeAddr(host, "wss://example.test");
  await act(async () => host.querySelector<HTMLButtonElement>(".dlg-f .pri")!.click());
  expect(readTarget()).toBe("wss://example.test");
  expect(readSavedTargets()).toEqual([{ url: "wss://example.test", name: "example.test" }]);
  expect(host.querySelector("[data-testid=connect-elsewhere]")).toBeNull();
  expect(host.querySelector("[data-testid=window-shell]")).toBeNull();
});
