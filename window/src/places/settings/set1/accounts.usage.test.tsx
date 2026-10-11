// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { AccountsPage, type Provider } from "./accounts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const HOUR = 3_600_000;
const NOW = Date.now();
// Four Claude setup-token accounts as models.authStatus returns them: three have made a request.
const claude = (name: string, five: number, week: number) => ({ profileId: `anthropic:${name}`, type: "token", status: "static", email: `${name}@example.com`,
  usage: { windows: [{ label: "5h", usedPercent: five, resetAt: NOW + 2 * HOUR }, { label: "Week", usedPercent: week, resetAt: NOW + 3 * 24 * HOUR }] } });
const PROVIDERS: Provider[] = [
  { provider: "anthropic", displayName: "Claude", status: "static", profiles: [claude("one", 9, 1), claude("two", 50, 20), claude("three", 100, 64), { profileId: "anthropic:four", type: "token", status: "static", email: "four@example.com" }] },
  { provider: "openai", displayName: "OpenAI", status: "ok", profiles: [{ profileId: "openai:me", type: "oauth", status: "ok", email: "me@example.com", usage: { plan: "pro", windows: [{ label: "168h", usedPercent: 54, resetAt: NOW + 4 * 24 * HOUR }] } }] },
];

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf(providers: Provider[]) {
  const request = vi.fn(async (method: string) => {
    if (method === "models.authStatus") return { ts: 1, providers, providerCapabilities: [] };
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    return {};
  });
  return { request, onEvent: () => () => undefined, sessionKey: "s", scopes: [] } as unknown as WindowEngine;
}
const report: SaveReport = { saving: vi.fn(), saved: vi.fn(), failed: vi.fn() };
const rowFor = (title: string) => [...host.querySelectorAll(".prow")].find((row) => row.querySelector("b")?.textContent?.includes(title));
const meters = (title: string) => [...(rowFor(title)?.querySelectorAll("[role=meter]") ?? [])].map((m) => [m.getAttribute("aria-label"), m.getAttribute("aria-valuenow")]);

describe("Settings Accounts allowance bars", () => {
  it("shows each Claude account's 5-hour and weekly bars with when they reset", async () => {
    await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><AccountsPage page="accounts" title="Accounts" level="regular" engine={engineOf(PROVIDERS)} /></KitProvider>));
    expect(meters("one@example.com")).toEqual([["This 5-hour window left", "91"], ["This week left", "99"]]);
    expect(meters("two@example.com")).toEqual([["This 5-hour window left", "50"], ["This week left", "80"]]);
    expect(meters("three@example.com")).toEqual([["This 5-hour window left", "0"], ["This week left", "36"]]);
    const one = rowFor("one@example.com")?.querySelector(".acc-usage")?.textContent ?? "";
    expect(one).toMatch(/91% left · resets \d{1,2}(:\d{2})? [AP]M/);
    expect(one).toMatch(/99% left · resets \d{1,2}(:\d{2})? [AP]M [A-Z][a-z]{2}/);
    // An account that hasn't made a request yet shows no bars rather than a made-up number.
    expect(rowFor("four@example.com")?.querySelector(".acc-usage")).toBeNull();
  });

  it("uses the same bars for a ChatGPT account and names its own plan", async () => {
    await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><AccountsPage page="accounts" title="Accounts" level="regular" engine={engineOf(PROVIDERS)} /></KitProvider>));
    expect(meters("me@example.com")).toEqual([["This 168-hour window left", "46"]]);
    expect(rowFor("me@example.com")?.textContent).toContain("pro");
  });
});
