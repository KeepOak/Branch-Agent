// The status bar and the setup wizard share one gateway control. It uses the desktop app's existing
// settings and service path (the same one Settings › Starting up and the tray use).
import { useCallback, type KeyboardEvent } from "react";
import { IN_BROWSER, useDesktopControls, type GatewayRunMode } from "../connect/desktop-controls";
import { shownWhy } from "./shown-why";

/** An older app. Plain on purpose: a developer note would leave the control silently grey. */
export const GATEWAY_APP_CANT = "This Branch app can't change the background service.";

export const GATEWAY_MODE_OPTIONS: { id: GatewayRunMode; name: string }[] = [
  { id: "off", name: "Off" },
  { id: "when-needed", name: "When needed" },
  { id: "on", name: "On" },
];

export function useGatewayRunControl() {
  const desk = useDesktopControls();
  const mode = desk.state?.gatewayMode;
  const known = mode === "off" || mode === "when-needed" || mode === "on";
  const canSet = Boolean(desk.bridge?.setGatewayMode);
  // A browser says to open the app. Any other missing bridge is an older app, said in plain words.
  const unavailable = desk.off === IN_BROWSER ? IN_BROWSER
    : !canSet ? GATEWAY_APP_CANT
    : desk.state && !known ? GATEWAY_APP_CANT
    : undefined;
  const pending = canSet && !desk.state && !unavailable;
  const disabled = Boolean(unavailable) || pending || desk.modeBusy;
  const note = !unavailable && known ? desk.error ?? desk.state?.notes?.keepWorking : undefined;
  const setMode = desk.setGatewayMode;
  const choose = useCallback((next: GatewayRunMode) => { void setMode(next); }, [setMode]);
  return { mode: known ? mode : undefined, disabled, unavailable, note, choose };
}

/** Status uses radio + the sliding segment. Setup uses aria-pressed, which its stylesheet selects on. */
export function GatewayModeButtons({ look, control, label }: {
  look: "status" | "setup";
  control: ReturnType<typeof useGatewayRunControl>;
  label: string;
}) {
  const index = control.mode === "when-needed" ? 1 : control.mode === "on" ? 2 : 0;
  const why = shownWhy(control.unavailable);
  const onKeyDown = (e: KeyboardEvent) => {
    if (control.disabled || look !== "status") return;
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step || !control.mode) return;
    e.preventDefault();
    const next = GATEWAY_MODE_OPTIONS[(index + step + GATEWAY_MODE_OPTIONS.length) % GATEWAY_MODE_OPTIONS.length];
    if (next) control.choose(next.id);
  };
  return (
    <span
      className={look === "status" ? "seg sp-seg" : "ob-seg"}
      role={look === "status" ? "radiogroup" : "group"}
      aria-label={label}
      aria-disabled={control.disabled ? true : undefined}
      title={why}
      data-testid={look === "status" ? "gw-mode" : "setup-gateway-mode"}
      style={look === "status" ? { gridTemplateColumns: "repeat(3, 1fr)", ["--i" as string]: index, ["--n" as string]: 3 } : undefined}
      onKeyDown={onKeyDown}
    >
      {GATEWAY_MODE_OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          role={look === "status" ? "radio" : undefined}
          aria-checked={look === "status" ? o.id === control.mode : undefined}
          aria-pressed={look === "setup" ? o.id === control.mode : undefined}
          disabled={control.disabled}
          onClick={() => { if (!control.disabled && o.id !== control.mode) control.choose(o.id); }}
        >
          {o.name}
        </button>
      ))}
    </span>
  );
}
