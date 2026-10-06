import type { MouseEvent } from "react";
import { Icon } from "./icons";
import type { MenuItem } from "./Menu";
import type { Level } from "../places-nav/settings-nav";

/** The machine switcher in the top bar's left half (DESIGN-SPEC §3.2, §4.1.1 Machine switcher): name and dot, no words. */
export function MachineSwitcher({ online, connecting, onOpen }: { online: boolean; connecting: boolean; onOpen: (e: MouseEvent<HTMLElement>) => void }) {
  const status = online ? "Online · you are here" : connecting ? "Connecting" : "Offline";
  return (
    <button type="button" className="machine" title="Which computer you’re talking to" data-testid="machine" onClick={onOpen}>
      <span className="machine-tile">
        <Icon name="monitor" small />
      </span>
      <span className="machine-name">This computer</span>
      <i className={online ? "mdot on" : connecting ? "mdot wait" : "mdot"} title={status} aria-hidden="true" />
      <span className="vh">{status}</span>
      <span className="machine-chev">
        <Icon name="down" small />
      </span>
    </button>
  );
}

type Ctx = { machineName: string; online: boolean; level: Level; roundTripMs: number | null; openSettings: (page: string) => void };

/** The computer menu shows only the selected, gateway-backed computer and navigation actions. */
export function machineMenuItems(c: Ctx): MenuItem[] {
  const status = c.online ? "Online · here" : "Offline";
  const trip = c.level === "technical" && c.online && c.roundTripMs !== null ? ` · ${c.roundTripMs} ms` : "";
  return [
    { kind: "head", label: "Talk to Branch on" },
    { kind: "info", label: c.machineName || "This computer", sub: `${status}${trip}`, checked: true },
    { kind: "sep" },
    { label: "Add a computer or phone…", run: () => c.openSettings("computer"), testid: "machine-add" },
    { label: "Connect to a Branch elsewhere…", run: () => window.dispatchEvent(new CustomEvent("branch:connect-elsewhere")), testid: "machine-elsewhere" },
    { label: "Computer settings…", run: () => c.openSettings("gateway"), testid: "machine-settings" },
  ];
}
