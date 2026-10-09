// @vitest-environment jsdom
// Settings › Branch account (p1-acct part A): Sign in with Google opens Google's page in the system browser, then
// shows the signed-in account; Sign out removes it. The engine is a stand-in.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { BranchAccountPage } from "./branch-account";

type Answers = Record<string, unknown | ((params: Record<string, unknown>) => unknown)>;
function engineWith(answers: Answers) {
  const request = vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    const a = answers[method];
    if (a instanceof Error) throw a;
    if (a === undefined) return {};
    return typeof a === "function" ? (a as (p: Record<string, unknown>) => unknown)(params) : a;
  });
  const engine: WindowEngine = { request: request as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] };
  return { engine, request };
}
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.body.innerHTML = ""; vi.restoreAllMocks(); });

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
async function show(engine: WindowEngine) {
  await act(async () => root.render(<BranchAccountPage page="account" title="Branch account" level="regular" engine={engine} />));
  await flush();
}
function button(text: string): HTMLButtonElement {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b as HTMLButtonElement;
}
async function click(text: string) { await act(async () => button(text).click()); await flush(); }
const calls = (request: ReturnType<typeof vi.fn>, method: string) => request.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>);

const SIGNED_OUT = { google: { available: true, signedIn: false, keychain: "Windows Credential Manager" } };
const SIGNED_IN = { google: { available: true, signedIn: true, email: "owner@example.test", signedInAt: Date.now() - 60_000, keychain: "Windows Credential Manager" } };
const GOOGLE_PAGE = "https://accounts.google.com/o/oauth2/v2/auth?client_id=stand-in&code_challenge_method=S256";

describe("Settings › Branch account", () => {
  it("Sign in with Google opens Google's page in the system browser, then shows the signed-in account", async () => {
    let signedIn = false;
    let finishSignIn: (value: unknown) => void = () => undefined;
    let nextCount = 0;
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { engine, request } = engineWith({
      "account.status": () => (signedIn ? SIGNED_IN : SIGNED_OUT),
      "account.google.signIn": (p) => ({ sessionId: p.sessionId, done: false, status: "running" }),
      "wizard.next": () => {
        nextCount += 1;
        if (nextCount === 1) {
          return { done: false, status: "running", step: { id: "p1", type: "progress", executor: "gateway", message: "Complete sign-in in your browser.", externalUrl: GOOGLE_PAGE } };
        }
        return new Promise((resolve) => { finishSignIn = resolve; });
      },
    });
    await show(engine);
    expect(document.body.textContent).toContain("Not signed in.");
    await click("Sign in with Google");

    const [start] = calls(request, "account.google.signIn");
    expect(Object.keys(start ?? {})).toEqual(["sessionId"]);
    expect(open).toHaveBeenCalledWith(GOOGLE_PAGE, "_blank", "noopener");
    expect(document.body.textContent).toContain("Waiting for the sign-in to finish in your browser…");
    expect(document.querySelector("iframe, webview")).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();

    signedIn = true;
    await act(async () => finishSignIn({ done: true, status: "done" }));
    await flush();
    expect(document.body.textContent).toContain("owner@example.test");
    expect(document.body.textContent).toContain("Kept in Windows Credential Manager.");
    expect(button("Sign out")).toBeTruthy();
  });

  it("Sign out removes the sign-in and offers Sign in with Google again", async () => {
    let signedIn = true;
    const { engine, request } = engineWith({
      "account.status": () => (signedIn ? SIGNED_IN : SIGNED_OUT),
      "account.signOut": () => { signedIn = false; return SIGNED_OUT; },
    });
    await show(engine);
    expect(document.body.textContent).toContain("owner@example.test");
    await click("Sign out");
    expect(calls(request, "account.signOut")).toEqual([{}]);
    expect(document.body.textContent).not.toContain("owner@example.test");
    expect(document.body.textContent).toContain("Signed out. The sign-in was removed from this computer.");
    expect(button("Sign in with Google").disabled).toBe(false);
  });

  it("shows the button disabled, with the reason, while this build has no Google sign-in", async () => {
    const { engine } = engineWith({
      "account.status": { google: { available: false, reason: "Google sign-in isn't set up for this build of Branch yet.", signedIn: false } },
    });
    await show(engine);
    expect(button("Sign in with Google").disabled).toBe(true);
    expect(document.body.textContent).toContain("Google sign-in isn't set up for this build of Branch yet.");
  });

  it("a cancelled sign-in returns to the button and tells the engine to stop", async () => {
    const { engine, request } = engineWith({
      "account.status": SIGNED_OUT,
      "account.google.signIn": (p) => ({ sessionId: p.sessionId, done: false, status: "running" }),
      "wizard.next": () => new Promise(() => undefined),
    });
    vi.spyOn(window, "open").mockReturnValue(null);
    await show(engine);
    await click("Sign in with Google");
    await click("Cancel");
    expect(calls(request, "wizard.cancel")).toHaveLength(1);
    expect(button("Sign in with Google")).toBeTruthy();
  });
});
