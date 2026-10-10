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

/** A round trip above this reads as "Slow" in the computer menu. */
const SLOW_MS = 1500;

/** The computer menu shows only the selected, gateway-backed computer and navigation actions. */
export function machineMenuItems(c: Ctx): MenuItem[] {
  const status = c.online ? "Online · here" : "Offline";
  // A raw round trip means nothing to a person; say "Slow" only when the link actually is.
  const trip = c.online && c.roundTripMs !== null && c.roundTripMs > SLOW_MS ? " · Slow" : "";
  const saved = readSavedTargets().filter(row => row.url !== c.homeUrl && row.url !== c.currentUrl);
  return [
    { kind: "head", label: "Talk to the assistant on…" },
    c.currentUrl === c.homeUrl
      ? { kind: "info", label: c.machineName || "This computer", sub: `${status}${trip}`, checked: true }
      : { label: "This computer", sub: "On this computer", run: () => c.onSwitch(c.homeUrl), testid: "machine-home" },
    ...(c.currentUrl !== c.homeUrl ? [{ kind: "info" as const, label: c.machineName || "Another computer", sub: `${status}${trip}`, checked: true }] : []),
    ...saved.map(row => ({ label: row.name, sub: "Saved computer", run: () => c.onSwitch(row.url), testid: "machine-saved" })),
    { kind: "sep" },
    {
      kind: "sub",
      label: "Add a computer or phone",
      testid: "machine-add",
      items: [
        { label: "Pair a computer or phone…", run: () => window.dispatchEvent(new CustomEvent("branch:add-computer")), testid: "machine-add-pair" },
        { label: "Link another Branch…", run: c.onLinkBranch, testid: "machine-link-branch" },
        { label: "Connect to a Branch elsewhere…", run: () => window.dispatchEvent(new CustomEvent("branch:connect-elsewhere")), testid: "machine-elsewhere" },
      ],
    },
    { label: "Computer settings…", run: () => c.openSettings("gateway"), testid: "machine-settings" },
  ];
}
