// @vitest-environment jsdom
// Settings › Accounts & usage draws the approved preview's cards (#1049, section D Accounts & usage majors): preview.html
// PG accounts rendered at Regular, Advanced and Technical. Usage by account is drawn here (spend, each account's usage
// and the four rows), Linked accounts is second, and no "Accounts, more", "Accounts, technical", GitHub or keepoak.com
// card is left: their rows sit in the preview's own cards at their level.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { forgetLookStore } from "../../../places/settings/set1/appearance-store";
import { PAGES } from "../nav";
import { ROWS } from "../rows";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

const CARDS = ["Usage by account", "Linked accounts", "Order Branch uses them in", "When one runs out", "Which account goes next", "Your own accounts", "Coding apps on this computer", "Where each sign-in comes from", "Terms"];

function engineOf() {
  const request = vi.fn(async (method: string, _params: Record<string, unknown> = {}) => {
    if (method === "config.get") return { hash: "h1", valid: true, config: {} };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    if (method === "sessions.usage") return { totals: { totalCost: 16.84 }, aggregates: { messages: { user: 164 } } };
    if (method === "usage.status") return { providers: [], updatedAt: Date.now() };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"] } as unknown as WindowEngine, request };
}
async function mount(engine: WindowEngine, level: "regular" | "advanced" | "technical") {
  localStorage.setItem("branch.level", level);
  await act(async () => root.render(<SettingsFrame engine={engine} page="accounts" pages={R1_PAGES} />));
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const remount = async () => { await act(async () => root.unmount()); root = createRoot(host); forgetLookStore(); };
const cards = () => [...host.querySelectorAll<HTMLElement>(".r1s-sec")].map((s) => s.querySelector(":scope > h2")?.textContent ?? "");
// Later-update rows sit inside the fold (main), so they are not direct children of the section.
const labels = (card: string) => [...host.querySelectorAll<HTMLElement>(`.r1s-sec[aria-label="${card}"] .r1s-row > b`)].map((b) => b.textContent);

it("lists the preview's Accounts cards, and every row sits on one of them", () => {
  expect(PAGES.accounts.cards).toEqual(CARDS);
  for (const row of ROWS.filter((r) => r.page === "accounts")) expect(CARDS, row.id).toContain(row.card);
});

it("draws the preview's cards at each level, Usage by account and Linked accounts first", async () => {
  const { engine } = engineOf();
  await mount(engine, "regular");
  expect(cards()).toEqual(["Usage by account", "Linked accounts", "Order Branch uses them in", "When one runs out", "Your own accounts", "Coding apps on this computer"]);
  await remount();
  await mount(engine, "advanced");
  expect(cards()).toEqual(["Usage by account", "Linked accounts", "Order Branch uses them in", "When one runs out", "Your own accounts", "Coding apps on this computer", "Terms"]);
  await remount();
  await mount(engine, "technical");
  expect(cards()).toEqual(CARDS);
});

it("draws Usage by account here: what Branch spent, each account, and the preview's four rows", async () => {
  await mount(engineOf().engine, "regular");
  const usage = host.querySelector<HTMLElement>('.r1s-sec[aria-label="Usage by account"]')!;
  expect(usage.textContent).toContain("Last 30 days");
  expect(usage.textContent).toContain("164 tasks");
  // The preview's four rows stay in this order. Regular draws the ones that work; the Coming row is folded in at Advanced.
  const usageRows = ROWS.filter((r) => r.page === "accounts" && r.card === "Usage by account" && !r.bare).map((r) => r.label);
  expect(usageRows).toEqual(["The ring bottom right", "Offer to save progress at 95%", "Asking a service what is left", "Show usage in the tray"]);
  expect(labels("Usage by account")).toEqual(["The ring bottom right", "Offer to save progress at 95%", "Show usage in the tray"]);
  expect(labels("Linked accounts")).toEqual(["GitHub", "Gmail", "Google Calendar", "Google Drive"]);
  // The GitHub access expiry is a value on the GitHub row, as the preview shows it, not a row of its own.
  expect(host.querySelector('[data-row="accounts.github.expires"]')).toBeNull();
  expect(labels("Your own accounts")).toContain("Your keepoak.com account");
});

it("puts the finer account rows in Your own accounts at Advanced and the sign-in rows at Technical", async () => {
  await mount(engineOf().engine, "technical");
  expect(labels("Usage by account")).toContain("Asking a service what is left");
  const own = labels("Your own accounts");
  for (const label of ["Which account each Trunk uses", "Helpers keep their account", "Pick by what the task needs", "Fallback keys", "Resting now", "Which sign-in each request used", "Organisation", "A customer’s ChatGPT plan on a KeepOak computer"]) expect(own).toContain(label);
  const sources = labels("Where each sign-in comes from");
  for (const label of ["A command that makes a sign-in", "On a build server, sign in with", "Accept sign-ins from your editor", "This Branch’s identity", "Sign-ins through the Gateway", "Settings from another Branch",
    "Keep service settings in step on my devices", "Use a model from a hub for one run", "Region", "Install a service’s package when needed", "Each account keeps its own folder", "Point your coding apps at Branch"]) expect(sources).toContain(label);
});
