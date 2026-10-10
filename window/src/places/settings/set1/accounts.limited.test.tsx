// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { KitProvider, type SaveReport } from "../kit";
import { AccountsPage, accountsOf, limitedLabel, type Provider } from "./accounts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const LIMITED_UNTIL = Date.now() + 30 * 60 * 60 * 1000;
const PROVIDERS: Provider[] = [
  { provider: "anthropic", displayName: "Claude", status: "ok", profileOrder: ["anthropic:first", "anthropic:second"], profiles: [
    { profileId: "anthropic:first", type: "token", status: "ok", limitedUntil: LIMITED_UNTIL },
    { profileId: "anthropic:second", type: "token", status: "ok" }] },
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
async function render(engine: WindowEngine) {
  await act(async () => root.render(<KitProvider level={0} report={report} scope={null}><AccountsPage page="accounts" title="Accounts" level="regular" engine={engine} /></KitProvider>));
}
const rowFor = (title: string) => [...host.querySelectorAll(".prow")].find((row) => row.querySelector("b")?.textContent?.includes(title));

describe("Settings Accounts limited accounts", () => {
  it("marks the first free account as used next, never a limited one", () => {
    expect(accountsOf(PROVIDERS).map((acc) => [acc.a.profileId, acc.next])).toEqual([["anthropic:first", false], ["anthropic:second", true]]);
  });

  it("shows Limited until <time> on a limited account and gives the used next pill to the next one", async () => {
    await render(engineOf(PROVIDERS));
    const first = rowFor("first");
    const second = rowFor("second");
    expect(first?.textContent).toContain(limitedLabel(LIMITED_UNTIL));
    expect(limitedLabel(LIMITED_UNTIL)).toMatch(/^Limited until [A-Z][a-z]{2} \d{1,2}:\d{2}\s?[AP]M$/);
    expect(first?.textContent).not.toContain("used next");
    expect(second?.textContent).toContain("used next");
    expect(second?.textContent).not.toContain("Limited until");
  });

  it("forgets the limit once its time has passed", async () => {
    const past: Provider[] = [{ ...PROVIDERS[0], profiles: [{ ...PROVIDERS[0].profiles[0], limitedUntil: Date.now() - 1_000 }, PROVIDERS[0].profiles[1]] }];
    await render(engineOf(past));
    expect(rowFor("first")?.textContent).toContain("used next");
    expect(host.textContent).not.toContain("Limited until");
  });
});
