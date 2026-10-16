// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { VisitorAccess } from "./visitor-access";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const POLICY = {
  policy: {
    managed: true,
    policyName: "Visitors (branch-managed)",
    defaultTtlDays: 14,
    maxVisitors: 50,
    roleId: "external-work",
    roleBound: true,
    apiToken: "secret-token-value",
    accountId: "acct-secret",
    appId: "app-secret",
  },
};
const LIST = {
  counts: { recorded: 1, inPolicy: 1, unmanaged: 1, missingFromPolicy: 0 },
  grants: [{
    email: "ada@example.test",
    grantId: "grant-1",
    profileId: "profile-ada",
    invitedAt: "2026-10-01T00:00:00.000Z",
    expiresAt: "2026-10-15T00:00:00.000Z",
    state: "managed",
    gatewayAccess: "Restricted guest",
  }],
  unmanaged: [{ email: "extra@example.test", gatewayAccess: "In the access policy" }],
};

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf(replies: Record<string, unknown>, scopes = ["operator.admin"]) {
  const request = vi.fn(async (method: string) => {
    const reply = replies[method];
    if (reply instanceof Error) throw reply;
    if (reply === undefined) throw new Error(`unknown method: ${method}`);
    return reply;
  });
  const engine = { request, onEvent: () => () => undefined, sessionKey: "s", scopes } as unknown as WindowEngine;
  return { engine, request };
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
async function render(engine: WindowEngine, admin = true) {
  await act(async () => root.render(
    <KitProvider level={0} report={report} scope={null}><VisitorAccess engine={engine} admin={admin} /></KitProvider>,
  ));
}
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);
const type = async (label: string, value: string) => {
  const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("Settings › People › Visitors", () => {
  it("says invitations are managed when this Branch has no visitor methods, and asks for no token", async () => {
    const { engine, request } = engineOf({});
    await render(engine);
    expect(host.textContent).toContain("Visitor invitations are managed by this Branch. They aren't set up on this computer yet.");
    expect(host.querySelector('[aria-label="Visitor email"]')).toBeNull();
    expect(host.textContent).not.toMatch(/cloudflare|api token|apiToken|secret-token/i);
    expect(request).toHaveBeenCalledWith("visitor.policy", {});
    expect(request).toHaveBeenCalledWith("visitor.list", {});
  });

  it("lists visitors, shows the access policy, invites and revokes", async () => {
    const { engine, request } = engineOf({
      "visitor.policy": POLICY,
      "visitor.list": LIST,
      "visitor.invite": { outcome: "invited", email: "bea@example.test" },
      "visitor.revoke": { outcome: "revoked", emails: ["ada@example.test"] },
    });
    await render(engine);
    expect(host.querySelector('[data-row="Access policy"] small')?.textContent).toContain("Visitors. Invitations last 14 days, up to 50. Guests you invite use this access policy.");
    expect(host.textContent).not.toMatch(/branch-managed|external-work/);
    expect(host.textContent).toContain("ada@example.test");
    expect(host.textContent).toContain("extra@example.test");
    expect(host.textContent).toContain("1 not recorded by Branch");
    expect(host.textContent).not.toMatch(/secret-token-value|acct-secret|app-secret|cloudflare|apiToken/i);

    await type("Visitor email", "bea@example.test");
    await type("Invitation length in days", "7");
    await act(async () => button("Invite")!.click());
    expect(request).toHaveBeenCalledWith("visitor.invite", { email: "bea@example.test", days: 7 });

    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Revoke ada@example.test"]')!.click());
    expect(request).toHaveBeenCalledWith("visitor.revoke", { profileId: "profile-ada" });
  });

  it("refuses both an email and a GitHub login, and keeps invite off for someone who may not change setup", async () => {
    const { engine, request } = engineOf({ "visitor.policy": POLICY, "visitor.list": LIST });
    await render(engine);
    await type("Visitor email", "bea@example.test");
    await type("GitHub login", "octocat");
    await act(async () => button("Invite")!.click());
    expect(host.textContent).toContain("Enter an email or a GitHub login.");
    expect(request.mock.calls.some(([method]) => method === "visitor.invite")).toBe(false);

    await render(engineOf({ "visitor.policy": POLICY, "visitor.list": LIST }).engine, false);
    expect(button("Invite")?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Revoke ada@example.test"]')?.disabled).toBe(true);
  });

  it("shows the configured policy name and role id only at Technical", async () => {
    const { engine } = engineOf({ "visitor.policy": POLICY, "visitor.list": LIST });
    await act(async () => root.render(
      <KitProvider level={2} report={report} scope={null}><VisitorAccess engine={engine} admin /></KitProvider>,
    ));
    expect(host.textContent).toContain("Visitors (branch-managed)");
    expect(host.textContent).toContain("The external-work role uses this access policy.");
  });
});
