import { useState } from "react";
import type { SettingsPageProps } from "../index";
import { Btn, Ctl, Hint, Page, Sec, Status } from "../kit";
import { componentDesktop, DESKTOP_CHECKS_HOURLY, MANUAL_UPDATE_UNSUPPORTED, useDesktopComponentStatus, type ComponentUpdateStatus } from "../../../connect/desktop-component-updates";
import { rec, str, useLive, type RecordValue } from "./common";

const OS: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

/** The desktop owns component publication and activation; no gateway update configuration is written here. */
export function DesktopUpdatesPage({ title, engine }: SettingsPageProps) {
  const desktop = componentDesktop(engine.gatewayUrl);
  const bridge = desktop?.componentUpdates;
  const data = useDesktopComponentStatus(engine.gatewayUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (method: "check" | "stage") => {
    if (!bridge || busy) return;
    setBusy(true); setError(null);
    try { const status = await bridge[method](); data.setStatus(status); setError(status.error); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  if (!bridge) return <HourlyUpdates title={title} engine={engine} reason={desktop?.unavailableReason} />;
  const lede = data.status?.currentVersion ? `Branch Agent ${data.status.currentVersion}.` : "Updates for Branch Agent on this computer.";
  return <Page title={title} lede={lede}>
    {error || data.error ? <Status tone="bad" title="Branch couldn’t update">{error || data.error}</Status> : null}
    <Status tone={data.status?.phase === "staged" ? "ok" : "idle"} title={statusLine(data.status)}>
      {data.status?.phase === "staged" ? "Restart Branch when your work is ready. Your conversations and settings stay in place." : "Checks for a new verified Branch Agent release."}
    </Status>
    <Sec title="Updating">
      <Ctl title="Check for updates"><Btn sm disabled={busy} onClick={() => void run("check")}>{busy ? "Working…" : "Check now"}</Btn></Ctl>
      {data.status?.phase === "available" ? <Ctl title={`Install ${data.status.latestVersion}`}><Btn disabled={busy} onClick={() => void run("stage")}>Install when nothing is running</Btn></Ctl> : null}
      <Hint>Branch checks when it starts and every hour. A downloaded update takes effect when Branch restarts.</Hint>
    </Sec>
  </Page>;
}

/** An older Branch Agent app has no Check now bridge, but it still checks every hour and stages updates by itself.
 *  Only this state reads the engine (its version, read-only); a window connected elsewhere keeps its own reason. */
function HourlyUpdates({ title, engine, reason }: Pick<SettingsPageProps, "title" | "engine"> & { reason?: string }) {
  const info = useLive<RecordValue>(engine, "status", {}, []);
  const sys = useLive<RecordValue>(engine, "system.info", {}, []);
  const version = str(rec(info.data).runtimeVersion);
  const os = OS[str(rec(sys.data).platform)] ?? str(rec(sys.data).osLabel);
  const lede = version ? `Branch Agent ${version}${os ? ` on ${os}` : ""}.` : "Updates for Branch Agent on this computer.";
  return <Page title={title} lede={lede}>
    {reason
      ? <Status tone="warn" title="Updates aren’t available here">{reason}</Status>
      : <Status title={version ? `Branch Agent ${version}` : "Branch Agent on this computer"}>{DESKTOP_CHECKS_HOURLY}</Status>}
    <Sec title="Updating">
      <Ctl title="Check for updates" off={reason ? undefined : MANUAL_UPDATE_UNSUPPORTED}><Btn sm disabled>Check now</Btn></Ctl>
      <Hint>A downloaded update takes effect when Branch restarts.</Hint>
    </Sec>
  </Page>;
}

function statusLine(status: ComponentUpdateStatus | null): string {
  if (!status) return "Reading desktop update status…";
  if (status.phase === "staged") return `${status.pendingVersion} is ready; restart to finish`;
  if (status.phase === "available") return `${status.latestVersion} is ready to install`;
  if (status.phase === "current") return "Branch is up to date.";
  if (status.phase === "checking") return "Checking for updates…";
  if (status.phase === "staging") return "Downloading and checking the update…";
  return status.currentVersion ? `Branch ${status.currentVersion}` : "Check for updates";
}
