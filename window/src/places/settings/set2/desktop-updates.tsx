import { useEffect, useState } from "react";
import type { SettingsPageProps } from "../index";
import { KeeperMark } from "../../../brand/KeeperMark";
import { Btn, Ctl, Hint, Page, Sec, Status, Switch } from "../kit";
import { useDesktopControls } from "../../../connect/desktop-controls";
import { componentDesktop, DESKTOP_CHECKS_HOURLY, MANUAL_UPDATE_UNSUPPORTED, useDesktopComponentStatus, type ComponentUpdateStatus } from "../../../connect/desktop-component-updates";
import { rec, str, useLive, type RecordValue } from "./common";
import { useBranchVersion, versionParts } from "../../../connect/branch-version";

const OS: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

/** The desktop owns component publication and activation; no gateway update configuration is written here. */
export function DesktopUpdatesPage({ title, engine }: SettingsPageProps) {
  const desktop = componentDesktop(engine.gatewayUrl);
  const bridge = desktop?.componentUpdates;
  const data = useDesktopComponentStatus(engine.gatewayUrl);
  const auto = useDesktopControls();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [work, setWork] = useState<{ runs: Array<{ runId: string; sessionKey: string; trunk: string; thread: string }> } | null>(null);
  useEffect(() => {
    if (data.status?.phase !== "staged") { setWork(null); return; }
    let live = true;
    const load = async () => {
      try {
        const next = await engine.request("system.updateWork", {}) as typeof work;
        if (live) setWork(next);
      } catch { if (live) setWork(null); }
    };
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => { live = false; clearInterval(timer); };
  }, [data.status?.phase, engine]);
  const run = async (method: "check" | "stage") => {
    if (!bridge || busy) return;
    setBusy(true); setError(null);
    try { const status = await bridge[method](); data.setStatus(status); setError(status.error); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  if (!bridge) return <HourlyUpdates title={title} engine={engine} reason={desktop?.unavailableReason} />;
  const current = data.status?.currentVersion;
  const lede = current ? `Branch ${versionParts(current).short} on this computer.` : "Updates for Branch on this computer.";
  return <Page title={title} lede={lede}>
    <div className="s2-keeper"><KeeperMark size={64} /></div>
    {error || data.error ? <Status tone="bad" title="Branch couldn’t update">{error || data.error}</Status> : null}
    <Status tone={data.status?.phase === "staged" ? "ok" : "idle"} title={statusLine(data.status, auto.state?.autoApplyUpdates !== false)}>
      {data.status?.phase === "staged" ? auto.state?.autoApplyUpdates === false
        ? "Restart Branch when your work is ready. Your conversations and settings stay in place."
        : "Your conversations and settings stay in place." : current ? `You have Branch ${versionParts(current).detail}. Checks for a new verified Branch release.` : "Checks for a new verified Branch release."}
    </Status>
    {data.status?.phase === "staged" ? <Sec title="What’s blocking this update">
      {work?.runs?.length ? <ul>{work.runs.map(run => <li key={run.runId}><b>{run.trunk}</b> · {run.thread}</li>)}</ul>
        : <Hint>{work ? "No Trunks are working. Branch will check its remaining update conditions." : "Checking active Trunks…"}</Hint>}
      <Btn disabled={busy || !bridge.install} onClick={() => {
        if (!bridge.install) return;
        if (work?.runs.length && !window.confirm(`Install now while ${work.runs.length} Trunk${work.runs.length === 1 ? " is" : "s are"} working? Their current work will be interrupted and resumed after the update.`)) return;
        setBusy(true); setError(null);
        void bridge.install().catch(caught => setError(caught instanceof Error ? caught.message : String(caught)))
          .finally(() => setBusy(false));
      }}>Install now</Btn>
      {!bridge.install ? <Hint>Install now needs a newer Branch desktop app.</Hint> : null}
    </Sec> : null}
    <Sec title="Updating">
      <Ctl title="Apply updates by themselves when no Trunk is working" off={auto.off}>
        <Switch label="Apply updates by themselves when no Trunk is working" checked={auto.state?.autoApplyUpdates ?? true}
          disabled={auto.busy !== null} onChange={on => void auto.set("autoApplyUpdates", on)} />
      </Ctl>
      <Ctl title="Check for updates"><Btn sm disabled={busy} onClick={() => void run("check")}>{busy ? "Working…" : "Check now"}</Btn></Ctl>
      {data.status?.phase === "available" ? <Ctl title="Install Branch update"><Btn disabled={busy} onClick={() => void run("stage")}>Install when idle</Btn></Ctl> : null}
      <Hint>Branch checks when it starts and every 10 minutes. A downloaded update applies after your Trunks finish.</Hint>
    </Sec>
  </Page>;
}

/** An older Branch Agent app has no Check now bridge, but it still checks every hour and stages updates by itself.
 *  The page still uses Branch's version; a window connected elsewhere keeps its own reason. */
function HourlyUpdates({ title, engine, reason }: Pick<SettingsPageProps, "title" | "engine"> & { reason?: string }) {
  const version = useBranchVersion(engine.gatewayUrl);
  const sys = useLive<RecordValue>(engine, "system.info", {}, []);
  const os = OS[str(rec(sys.data).platform)] ?? str(rec(sys.data).osLabel);
  const lede = version ? `Branch ${versionParts(version).short}${os ? ` on ${os}` : ""}.` : "Updates for Branch on this computer.";
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

function statusLine(status: ComponentUpdateStatus | null, autoApply: boolean): string {
  if (!status) return "Reading desktop update status…";
  if (status.phase === "staged") return autoApply ? "Update ready, applying when your Trunks finish" : "A Branch update is ready; restart to finish";
  if (status.phase === "available") return "A Branch update is ready";
  if (status.phase === "current") return "Branch is up to date.";
  if (status.phase === "checking") return "Checking for updates…";
  if (status.phase === "staging") return "Downloading and checking the update…";
  return status.currentVersion ? `Branch ${versionParts(status.currentVersion).short}` : "Check for updates";
}
