// @vitest-environment jsdom
// Settings › Automations is a native R1 page (#1049, section D blockers 1 and 2): it never hands the window to Classic
// Settings or Classic Advanced, and it draws the approved preview's cards in the preview's order at each level
// (preview.html PG autos, rendered at Regular, Advanced and Technical: nothing at Regular but "These settings show at
// Advanced", then Automations and Steps and nudges), with the preview's row words.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../../connect/engine";
import { forgetLookStore } from "../../../places/settings/set1/appearance-store";
import { CLASSIC_PAGE, r1SettingsPage } from "../../frame/R1Window";
import { PAGES } from "../nav";
import { SettingsFrame } from "../SettingsFrame";
import { R1_PAGES } from "./plugged";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); root = createRoot(host); localStorage.clear(); forgetLookStore(); });
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; });

function engineOf(config: Record<string, unknown> = {}) {
  const request = vi.fn(async (method: string, _params: Record<string, unknown> = {}) => {
    if (method === "config.get") return { hash: "h1", valid: true, config };
    if (method === "config.patch") return { ok: true };
    if (method === "config.schema") return { schema: {}, uiHints: {} };
    if (method === "config.schema.lookup") return { reloadKind: "hot" };
    if (method === "users.prefs.get") return { status: "ok", entries: {} };
    return {};
  });
  return { engine: { request, onEvent: () => () => undefined, sessionKey: "s", scopes: ["operator.admin"] } as unknown as WindowEngine, request };
}
async function mount(engine: WindowEngine, level: "regular" | "advanced" | "technical") {
  localStorage.setItem("branch.level", level);
  await act(async () => root.render(<SettingsFrame engine={engine} page="autos" pages={R1_PAGES} />));
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const remount = async () => { await act(async () => root.unmount()); root = createRoot(host); forgetLookStore(); };
const cards = () => [...host.querySelectorAll<HTMLElement>(".r1s-sec")].map((s) => s.querySelector(":scope > h2")?.textContent ?? "");
const labels = (card: string) => [...host.querySelectorAll<HTMLElement>(`.r1s-sec[aria-label="${card}"] .r1s-row > b`)].map((b) => b.textContent);
const ADVANCED = ["Run on GitHub Actions while this computer is off", "Report only what changed", "Checks and retries in procedures", "Procedures that start themselves", "Start when a USB device is plugged in",
  "Reach webhooks from outside", "Use what the trigger sent", "Checks before a run and event triggers", "Tell me when an automation keeps failing", "After failures in a row", "At most every", "Count skipped runs",
  "Send alerts to", "How", "Catch up on runs missed while Branch was off", "Keep each run’s own conversation for", "Run history"];

it("is an R1 Settings page, never Classic Advanced", () => {
  expect(r1SettingsPage("autos", R1_PAGES)).toBe(true);
  expect(CLASSIC_PAGE.autos).toBeUndefined();
  expect(PAGES.autos.cards).toEqual(["Automations", "Steps and nudges"]);
});

it("draws the preview's cards: none at Regular, then Automations and Steps and nudges", async () => {
  const { engine } = engineOf();
  await mount(engine, "regular");
  expect(cards()).toEqual([]);
  expect(host.querySelector(".r1s-empty")?.textContent).toContain("These settings show at Advanced.");
  await remount();
  await mount(engine, "advanced");
  expect(cards()).toEqual(["Automations", "Steps and nudges"]);
  expect(labels("Automations")).toEqual(ADVANCED);
  expect(labels("Steps and nudges")).toEqual(["Steps for other apps", "Nudge a long task that stops early"]);
  await remount();
  await mount(engine, "technical");
  expect(cards()).toEqual(["Automations", "Steps and nudges"]);
  expect(labels("Automations")).toEqual([...ADVANCED.slice(0, 13), "Recipient", "Chat-app account", ...ADVANCED.slice(13), "Private addresses allowed for web addresses",
    "Chat commands", "Hooks", "Which Trunk answers", "Schedules", "Flow search", "Loop a prompt"]);
});

it("keeps Classic's working failure-alert controls on the keys Classic uses", async () => {
  const { engine, request } = engineOf({ channels: { telegram: { enabled: true } }, cron: { sessionRetention: false } });
  await mount(engine, "advanced");
  const keep = host.querySelector<HTMLElement>('[data-row="autos.autos.keep-run"]')!;
  expect(keep.querySelector("[aria-checked=true]")?.textContent).toBe("Forever");
  const to = host.querySelector<HTMLSelectElement>('[data-row="autos.autos.alert-to"] select')!;
  expect([...to.options].map((o) => o.textContent)).toEqual(["Where each automation sends", "Telegram", "A web address"]);
  await act(async () => { to.value = "telegram"; to.dispatchEvent(new Event("change", { bubbles: true })); await new Promise((r) => setTimeout(r, 0)); });
  const patch = request.mock.calls.find(([m]) => m === "config.patch")!;
  expect(JSON.parse(String((patch[1] as { raw: string }).raw))).toEqual({ cron: { failureAlert: { mode: "announce", channel: "telegram" } } });
});
