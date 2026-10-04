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

/** The machine menu (§4.1.3, §4.9.2): the workspace, the computer this window talks to, and where to add or change it.
 *  The team workspace needs keepoak.com, which the engine can't connect yet, so its row says so. */
export function machineMenuItems(c: Ctx): MenuItem[] {
  const status = c.online ? "Online · you are here" : "Offline · Open the connection settings to fix it.";
  const trip = c.level === "technical" && c.online && c.roundTripMs !== null ? ` · ${c.roundTripMs} ms` : "";
  return [
    { kind: "head", label: "Workspace" },
    { kind: "info", label: "Personal", sub: "Just you and this household", checked: true },
    { label: "Your team · Connect keepoak.com to see your team", run: () => undefined, disabled: "Connecting keepoak.com isn't in the engine yet." },
    { kind: "sep" },
    { kind: "head", label: "Talk to the assistant on…" },
    { kind: "info", label: c.machineName || "This computer", sub: `${status}${trip}`, checked: true, dot: c.online ? "ok" : "off" },
    { kind: "sep" },
    { label: "Add a computer or phone…", run: () => c.openSettings("computer"), testid: "machine-add" },
    { label: "Connect to a Branch elsewhere…", run: () => window.dispatchEvent(new CustomEvent("branch:connect-elsewhere")), testid: "machine-elsewhere" },
    { label: "Computer settings…", run: () => c.openSettings("gateway"), testid: "machine-settings" },
  ];
}
