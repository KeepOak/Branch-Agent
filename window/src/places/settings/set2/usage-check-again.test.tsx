// @vitest-environment jsdom
// A failed allowance row says why in plain words and offers Check again; a sign-in failure also offers Sign in again.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider } from "../kit";
import { AccountAllowanceList, UsagePage } from "./usage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAW = /ECONNREFUSED|127\.0\.0\.1|Token expired|HTTP 401/;
const ENGINE = "connect ECONNREFUSED 127.0.0.1:18789";
const REACH = "Branch can’t reach its engine right now. It keeps trying, so try again in a moment.";

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

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  host = document.createElement("div");
  host.className = "set-col";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
});

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
function button(text: string, scope: ParentNode = document): HTMLButtonElement | undefined {
  return [...scope.querySelectorAll("button")].find((x) => x.textContent?.trim() === text) as HTMLButtonElement | undefined;
}
async function click(text: string, scope?: ParentNode) {
  const b = button(text, scope);
  expect(b, text).toBeTruthy();
  await act(async () => b!.click());
  await flush();
}
const calls = (request: ReturnType<typeof vi.fn>, method: string) => request.mock.calls.filter(([m]) => m === method);

const STATUS = {
  updatedAt: Date.now() - 4 * 60_000,
  providers: [
    { provider: "openai", displayName: "OpenAI", windows: [], error: ENGINE },
    { provider: "zai", displayName: "Z.ai", windows: [], error: "Token expired" },
    { provider: "google", displayName: "Google Gemini", windows: [], error: "HTTP 401" },
  ],
};

async function showList(engine: WindowEngine, openSettings?: (page: string) => void) {
  await act(async () => root.render(
    <KitProvider level={0} report={{ saving: () => undefined, saved: () => undefined, failed: () => undefined }} scope={null}>
      <AccountAllowanceList engine={engine} openSettings={openSettings} />
    </KitProvider>,
  ));
  await flush();
}

describe("Allowance rows that could not check offer a next step", () => {
  it("a failed check shows plain text plus Check again, which reads usage.status again", async () => {
    const { engine, request } = engineWith({ "usage.status": STATUS, "models.authStatus": { providers: [] } });
    await showList(engine);
    const row = document.querySelector('[data-provider="openai"]')!;
    expect(row.textContent).toContain("Couldn’t check");
    expect(row.textContent).toContain("couldn't share usage right now");
    expect(row.textContent).not.toMatch(RAW);
    expect(button("Sign in again", row)).toBeUndefined();
    const before = calls(request, "usage.status").length;
    await click("Check again", row);
    expect(calls(request, "usage.status").length).toBeGreaterThan(before);
  });

  it("a sign-in failure offers Sign in again and still offers Check again", async () => {
    const openSettings = vi.fn();
    const { engine, request } = engineWith({ "usage.status": STATUS, "models.authStatus": { providers: [] } });
    await showList(engine, openSettings);
    const zai = document.querySelector('[data-provider="zai"]')!;
    expect(zai.textContent).toContain("Sign in again");
    expect(zai.textContent).toContain("needs you to sign in again");
    expect(zai.textContent).not.toContain("Token expired");
    expect(button("Check again", zai)).toBeTruthy();
    await click("Sign in again", zai);
    expect(openSettings).toHaveBeenCalledWith("accounts");
    expect(sessionStorage.getItem("branch.openAddAccount")).toBe("zai");

    const google = document.querySelector('[data-provider="google"]')!;
    expect(button("Sign in again", google)).toBeTruthy();
    expect(google.textContent).not.toMatch(/HTTP 401/);
    const before = calls(request, "usage.status").length;
    await click("Check again", google);
    expect(calls(request, "usage.status").length).toBeGreaterThan(before);
  });

  it("Data & usage wraps a failed usage.status read in plain words", async () => {
    const { engine } = engineWith({
      "usage.status": new Error(ENGINE),
      "models.authStatus": { providers: [] },
      "sessions.usage": { totals: { totalCost: 0 }, aggregates: { messages: { user: 0 }, byAgent: [] } },
      "agents.list": { agents: [] },
    });
    await act(async () => root.render(
      <KitProvider level={0} report={{ saving: () => undefined, saved: () => undefined, failed: () => undefined }} scope={null}>
        <UsagePage page="usage" title="Data & usage" level="regular" engine={engine} />
      </KitProvider>,
    ));
    await flush();
    const alert = host.querySelector('[role="alert"]')?.textContent ?? "";
    expect(alert).toBe(REACH);
    expect(alert).not.toMatch(RAW);
  });
});
