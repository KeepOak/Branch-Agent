// @vitest-environment jsdom
// Settings: the desktop app's usage switch is one line, worded the same on the R1 Accounts page and the Classic Data &
// usage page, and the R1 Privacy page (which re-hosts Classic Data & usage) leaves it out so it shows once. A Mac has a
// menu bar, not a tray: the switch and the Appearance card for Branch's icon say menu bar there.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, "platform");
const PLATFORMS = [
  { name: "macOS", navigator: "MacIntel", place: "menu bar", card: "Menu bar" },
  { name: "Windows", navigator: "Win32", place: "tray", card: "Tray" },
  { name: "Linux", navigator: "Linux x86_64", place: "tray", card: "Tray" },
];
const NOOP = { saving: () => undefined, saved: () => undefined, failed: () => undefined };
const engine: WindowEngine = { request: (async () => ({})) as WindowEngine["request"], onEvent: () => () => {}, sessionKey: "agent:main:main", agentId: "main", scopes: ["operator.admin"] };

let root: Root;
let host: HTMLDivElement;
beforeEach(() => { host = document.body.appendChild(document.createElement("div")); host.className = "set-col"; root = createRoot(host); });
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  delete (navigator as { platform?: string }).platform;
  if (platform) Object.defineProperty(Navigator.prototype, "platform", platform);
  vi.resetModules();
});

/** The Settings modules as this platform loads them (their row tables are built once, at load). */
async function load(nav: string) {
  Object.defineProperty(navigator, "platform", { value: nav, configurable: true });
  vi.resetModules();
  const [accounts, appearance, navMod, hostMod, usage, kit, sections] = await Promise.all([
    import("./pages/accounts"), import("./pages/appearance"), import("./nav"), import("./pages/classic-host"),
    import("../../places/settings/set2/usage"), import("../../places/settings/kit"), import("../../places/settings/set1/appearance-sections"),
  ]);
  return { accounts, appearance, navMod, hostMod, usage, kit, sections };
}

const usageLines = (labels: (string | undefined)[]) => labels.filter((l): l is string => /show usage in the/i.test(l ?? ""));

describe("the usage switch and the tray words, per platform", () => {
  for (const p of PLATFORMS) {
    it("R1 says " + p.place + " on " + p.name + ", once across Accounts and Privacy", async () => {
      const { accounts, appearance, navMod, hostMod } = await load(p.navigator);
      const tray = accounts.ACCOUNTS_ROWS.find((r) => r.id === "accounts.usage.tray");
      expect(tray?.label).toBe("Show usage in the " + p.place);
      expect(tray?.help).toBe("The ring from the bottom bar, also in the " + p.place + ".");
      // Privacy re-hosts Classic Data & usage: its search rows leave the switch to Accounts.
      const labels = [...accounts.ACCOUNTS_ROWS, ...hostMod.classicRows("privacy", "usage")].map((r) => r.label);
      expect(usageLines(labels)).toEqual(["Show usage in the " + p.place]);
      // Appearance's card for Branch's icon uses the platform's word.
      expect(navMod.PAGES.appearance.cards).toContain(p.card);
      const menu = appearance.APPEARANCE_ROWS.find((r) => r.id === "appearance.tray.menu");
      expect(menu?.card).toBe(p.card);
      const words = [menu?.card, menu?.label, menu?.help, menu?.source.kind === "coming" ? menu.source.reason : ""].join(" ");
      if (p.name === "macOS") expect(words).not.toMatch(/tray/i);
      else expect(words).not.toMatch(/menu bar/i);
    });

    it("Classic says " + p.place + " on " + p.name + ": one switch, left out when R1 re-hosts the page", async () => {
      const { usage, kit, sections } = await load(p.navigator);
      const draw = async (hosted: boolean) => {
        await act(async () => root.render(
          <kit.KitProvider level={0} report={NOOP} scope={null} hosted={hosted}>
            <usage.UsagePage page="usage" title="Data & usage" level="regular" engine={engine} />
            <sections.TraySec />
          </kit.KitProvider>,
        ));
        for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
        return [...host.querySelectorAll<HTMLElement>(".ctl[data-row]")].map((el) => el.dataset.row ?? "");
      };
      expect(usageLines(await draw(false))).toEqual(["Show usage in the " + p.place]);
      expect(host.textContent).not.toContain("Also show usage");
      expect(host.textContent).not.toContain(p.name === "macOS" ? "tray" : "menu bar");
      expect([...host.querySelectorAll("h2, h3")].map((h) => h.textContent?.trim())).toContain(p.card);
      expect(usageLines(await draw(true))).toEqual([]);
    });
  }
});
