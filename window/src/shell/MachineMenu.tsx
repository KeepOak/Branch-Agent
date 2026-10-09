import type { MouseEvent } from "react";
import { Icon } from "./icons";
import type { MenuItem } from "./Menu";
import type { Level } from "../places-nav/settings-nav";
import { readSavedTargets } from "../setup/pre-connect-state";

/** The machine switcher in the top bar's left half (DESIGN-SPEC §3.2, §4.1.1 Machine switcher): name and dot, no words. */
export function MachineSwitcher({ name = "This computer", online, connecting, onOpen }: { name?: string; online: boolean; connecting: boolean; onOpen: (e: MouseEvent<HTMLElement>) => void }) {
  const status = online ? "Online · you are here" : connecting ? "Connecting" : "Offline";
  return (
    <button type="button" className="machine" title="Which computer you’re talking to" data-testid="machine" onClick={onOpen}>
      <span className="machine-tile">
        <Icon name="monitor" small />
      </span>
      <span className="machine-name">{name}</span>
      <i className={online ? "mdot on" : connecting ? "mdot wait" : "mdot"} title={status} aria-hidden="true" />
      <span className="vh">{status}</span>
      <span className="machine-chev">
        <Icon name="down" small />
      </span>
    </button>
  );
}

type Ctx = { machineName: string; currentUrl: string; homeUrl: string; online: boolean; level: Level; roundTripMs: number | null; openSettings: (page: string) => void; onLinkBranch: () => void; onSwitch: (url: string) => void };

/** One row per real computer: the one on screen, the home computer, and saved ones. Same name, same computer. */
export function machineMenuItems(c: Ctx): MenuItem[] {
  const current = c.machineName || "This computer";
  const names = new Set([current.trim().toLowerCase()]);
  const home = c.currentUrl === c.homeUrl ? [] : [{ label: "This computer", url: c.homeUrl }];
  if (home.length) names.add("this computer");
  const saved = readSavedTargets().filter((row) => {
    const key = row.name.trim().toLowerCase();
    if (row.url === c.currentUrl || row.url === c.homeUrl || names.has(key)) return false;
    names.add(key);
    return true;
  });
  return [
    { kind: "head", label: "Computers" },
    { kind: "info", label: current, sub: c.online ? "Online" : "Offline", checked: true },
    ...home.map((row) => ({ label: row.label, sub: "Saved", run: () => c.onSwitch(row.url), testid: "machine-home" })),
    ...saved.map((row) => ({ label: row.name, sub: "Saved", run: () => c.onSwitch(row.url), testid: "machine-saved" })),
    { kind: "sep" },
    {
      kind: "sub",
      label: "Add a computer or Branch…",
      testid: "machine-add",
      items: [
        { label: "Another computer with Branch", run: () => window.dispatchEvent(new CustomEvent("branch:add-computer")), testid: "machine-add-computer" },
        { label: "A Branch on another computer, by address", run: () => window.dispatchEvent(new CustomEvent("branch:connect-elsewhere")), testid: "machine-elsewhere" },
        { label: "Link a Branch with an invitation", run: c.onLinkBranch, testid: "machine-link-branch" },
      ],
    },
    { label: "Computer settings…", run: () => c.openSettings("gateway"), testid: "machine-settings" },
  ];
}
