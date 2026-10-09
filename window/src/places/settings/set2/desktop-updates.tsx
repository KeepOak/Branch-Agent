import { useEffect, useState } from "react";
import type { SettingsPageProps } from "../index";
import { KeeperMark } from "../../../brand/KeeperMark";
import { Btn, Ctl, Hint, Page, Sec, Status, Switch } from "../kit";
import { useDesktopControls } from "../../../connect/desktop-controls";
import { componentDesktop, DESKTOP_CHECKS_HOURLY, MANUAL_UPDATE_UNSUPPORTED, useDesktopComponentStatus, type ComponentUpdateStatus } from "../../../connect/desktop-component-updates";
import { rec, str, useLive, type RecordValue } from "./common";
import { isNewerBranchVersion, runningBranchVersion, useBranchVersion, useShippedWindowVersion, versionParts } from "../../../connect/branch-version";

const OS: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

/** The desktop owns component publication and activation; no gateway update configuration is written here. */
export function DesktopUpdatesPage({ title, engine }: SettingsPageProps) {
  const desktop = componentDesktop(engine.gatewayUrl);
  const bridge = desktop?.componentUpdates;
  const data = useDesktopComponentStatus(engine.gatewayUrl);
  const shipped = useShippedWindowVersion();
  const auto = useDesktopControls();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installRequested, setInstallRequested] = useState(false);
  const staged = data.status?.phase === "staged";
  useEffect(() => { if (!staged) setInstallRequested(false); }, [staged]);
  const run = async (method: "check" | "stage") => {
    if (!bridge || busy) return;
    setBusy(true); setError(null);
    try { const status = await bridge[method](); data.setStatus(status); setError(status.error); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  if (!bridge) return <HourlyUpdates title={title} engine={engine} reason={desktop?.unavailableReason} />;
  const running = runningBranchVersion(data.status?.currentVersion, shipped);
  const stagedWaiting = Boolean(data.status?.phase === "staged" && isNewerBranchVersion(data.status.pendingVersion ?? data.status.latestVersion, running));
  const lede = running ? `Branch ${versionParts(running).detail} on this computer.` : "Updates for Branch on this computer.";
  const install = bridge.install;
  return <Page title={title} lede={lede}>
    <div className="s2-keeper"><KeeperMark size={64} /></div>
    {error || data.error ? <Status tone="bad" title="Branch couldn’t update">{error || data.error}</Status> : null}
    <Status tone={stagedWaiting ? "ok" : "idle"} title={statusLine(data.status, stagedWaiting)}>
      {stagedWaiting ? installRequested
        ? "Installing. Running work carries on for up to about 5 minutes, then Branch restarts and picks up anything interrupted."
        : "Downloaded and checked. Your conversations and settings stay in place." : running ? `You have Branch ${versionParts(running).detail}. Checks for a new verified Branch release.` : "Checks for a new verified Branch release."}
    </Status>
    <Sec title="Updating">
      <Ctl title="Apply updates automatically" off={auto.off}>
        <Switch label="Apply updates automatically" checked={auto.state?.autoApplyUpdates ?? true}
          disabled={auto.busy !== null} onChange={on => void auto.set("autoApplyUpdates", on)} />
      </Ctl>
      <Ctl title="Check for updates"><Btn sm disabled={busy} onClick={() => void run("check")}>{busy ? "Working…" : "Check now"}</Btn></Ctl>
      {data.status?.phase === "available" ? <Ctl title="Update available"><Btn disabled={busy} onClick={() => void run("stage")}>Download update</Btn></Ctl> : null}
      {stagedWaiting && install ? <Ctl title="Install now" sub="Running work carries on for up to about 5 minutes, then Branch restarts and picks up anything interrupted.">
        <Btn pri sm disabled={installRequested} onClick={() => { install(); setInstallRequested(true); }}>{installRequested ? "Installing…" : "Install now"}</Btn>
      </Ctl> : null}
      <Hint>Branch checks every 10 minutes. A ready update installs by itself once every Trunk is idle, which can take a long time on a busy computer. Install now doesn’t wait for that.</Hint>
    </Sec>
  </Page>;
}

/** An older Branch Agent app has no Check now bridge, but it still checks every hour and stages updates by itself.
 *  The page still uses Branch's version; a window connected elsewhere keeps its own reason. */
function HourlyUpdates({ title, engine, reason }: Pick<SettingsPageProps, "title" | "engine"> & { reason?: string }) {
  const version = useBranchVersion(engine.gatewayUrl);
  const sys = useLive<RecordValue>(engine, "system.info", {}, []);
  const os = OS[str(rec(sys.data).platform)] ?? str(rec(sys.data).osLabel);
  const lede = version ? `Branch ${versionParts(version).detail}${os ? ` on ${os}` : ""}.` : "Updates for Branch on this computer.";
  return <Page title={title} lede={lede}>
    <div className="s2-keeper"><KeeperMark size={64} /></div>
    {reason
      ? <Status tone="warn" title="Updates aren’t available here">{reason}</Status>
      : <Status title={version ? `You have Branch ${versionParts(version).detail}` : "Branch on this computer"}>{DESKTOP_CHECKS_HOURLY}</Status>}
    <Sec title="Updating">
      <Ctl title="Check for updates" off={reason ? undefined : MANUAL_UPDATE_UNSUPPORTED}><Btn sm disabled>Check now</Btn></Ctl>
      <Hint>A downloaded update takes effect when Branch restarts.</Hint>
    </Sec>
  </Page>;
}

function statusLine(status: ComponentUpdateStatus | null, stagedWaiting: boolean): string {
  if (!status) return "Reading desktop update status…";
  if (stagedWaiting) return "Update ready to install";
  if (status.phase === "available") return "A Branch update is ready";
  if (status.phase === "current" || status.phase === "staged") return "Branch is up to date.";
  if (status.phase === "checking") return "Checking for updates…";
  if (status.phase === "staging") return "Downloading and checking the update…";
  return status.currentVersion ? `Branch ${versionParts(status.currentVersion).detail}` : "Check for updates";
}
