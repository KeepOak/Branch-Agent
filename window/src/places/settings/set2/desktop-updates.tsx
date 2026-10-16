import { useEffect, useState } from "react";
import type { SettingsPageProps } from "../index";
import { KeeperMark } from "../../../brand/KeeperMark";
import { Btn, Ctl, Hint, Page, Sec, Status, Switch } from "../kit";
import { useDesktopControls } from "../../../connect/desktop-controls";
import { componentDesktop, DESKTOP_CHECKS_HOURLY, ENGINE_UPDATE_EVENT, MANUAL_UPDATE_UNSUPPORTED, useDesktopComponentStatus, type ComponentUpdateStatus, type EngineUpdateEvent, undoOpen, useDesktopUndoAvailability, type ComponentUpdates, type UndoAvailability } from "../../../connect/desktop-component-updates";

/** The desktop drains running work for up to 330 s, then restarts; a silent desktop gets this long plus a 60 s margin. */
export const INSTALL_NO_ANSWER_MS = 390_000;
const NO_ANSWER_MESSAGE = "Branch didn’t confirm the update. It may still finish: check the version in a few minutes, or restart Branch.";
import { rec, str, useLive, type RecordValue } from "./common";
import { WhatsNewRow } from "./whats-new-row";
import { versionLabel } from "../internals";
import { isNewerBranchVersion, runningBranchVersion, useBranchVersion, useShippedWindowVersion, versionParts } from "../../../connect/branch-version";
import { latestVersionLine, useMinuteClock } from "./version-line";

const OS: Record<string, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

/** The desktop owns component publication and activation; no gateway update configuration is written here. */
export function DesktopUpdatesPage({ title, engine, level }: SettingsPageProps) {
  const desktop = componentDesktop(engine.gatewayUrl);
  const bridge = desktop?.componentUpdates;
  const data = useDesktopComponentStatus(engine.gatewayUrl);
  const shipped = useShippedWindowVersion();
  const auto = useDesktopControls();
  const [busy, setBusy] = useState<"" | "check" | "stage">("");
  const [error, setError] = useState<string | null>(null);
  // The finished Check now, in case an older desktop's answer carries no checkedAt of its own.
  const [checkedHere, setCheckedHere] = useState<number | null>(null);
  const now = useMinuteClock();
  const [installRequested, setInstallRequested] = useState(false);
  const [outcome, setOutcome] = useState<EngineUpdateEvent | null>(null);
  const bar = outcome?.state ?? null;
  const staged = data.status?.phase === "staged";
  useEffect(() => {
    const onState = (event: Event) => setOutcome((event as CustomEvent<EngineUpdateEvent>).detail);
    window.addEventListener(ENGINE_UPDATE_EVENT, onState);
    return () => window.removeEventListener(ENGINE_UPDATE_EVENT, onState);
  }, []);
  // Every terminal outcome ends "Updating…": succeeded, postponed, failed, or no answer before the bound.
  useEffect(() => { if (bar === "kept" || bar === "updated" || bar === "failed") setInstallRequested(false); }, [bar]);
  useEffect(() => { if (!installRequested) return; const timer = setTimeout(() => setOutcome({ state: "failed", message: NO_ANSWER_MESSAGE }), INSTALL_NO_ANSWER_MS); return () => clearTimeout(timer); }, [installRequested]);
  useEffect(() => { if (!staged) setInstallRequested(false); }, [staged]);
  const run = async (method: "check" | "stage") => {
    if (!bridge || busy) return;
    setBusy(method); setError(null);
    try { const status = await bridge[method](); data.setStatus(status); setError(status.error); if (method === "check" && !status.error) setCheckedHere(Date.now()); }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(""); }
  };
  if (!bridge) return <HourlyUpdates title={title} engine={engine} level={level} reason={desktop?.unavailableReason} />;
  const running = runningBranchVersion(data.status?.currentVersion, shipped);
  const stagedWaiting = Boolean(data.status?.phase === "staged" && isNewerBranchVersion(data.status.pendingVersion ?? data.status.latestVersion, running));
  const autoApply = auto.state?.autoApplyUpdates !== false;
  const lede = running ? `Branch ${versionLabel(running, level)} on this computer.` : "Updates for Branch on this computer.";
  const install = bridge.install;
  const requestInstall = () => { if (!install || installRequested) return; setOutcome(null); install(); setInstallRequested(true); };
  const failed = !installRequested && bar === "failed";
  const pendingLabel = versionLabel(data.status?.pendingVersion ?? data.status?.latestVersion ?? "", level);
  const headline = installRequested ? (bar === "preparing" ? "Getting the update ready…" : "Updating Branch…")
    : failed ? "The update didn’t finish"
    : bar === "kept" ? "Update postponed; Branch kept the current version"
    : stagedWaiting ? `${pendingLabel} is staged`
    : busy === "check" ? "Checking for updates…"
    : statusLine(data.status, level, Math.max(data.status?.checkedAt ?? 0, checkedHere ?? 0) || null, now);
  return <Page title={title} lede={lede}>
    <div className="s2-keeper"><KeeperMark size={64} /></div>
    {error || data.error ? <Status tone="bad" title="Branch couldn’t update">{error || data.error}</Status> : null}
    <Status tone={failed ? "bad" : stagedWaiting ? "ok" : "idle"} title={headline}>
      {failed ? (outcome?.message || "Branch kept the current version.")
        : stagedWaiting && installRequested ? "Running work moves across to the new engine. Your conversations and settings stay in place."
        : stagedWaiting ? "It applies by itself, in place, the next time no Trunk is working. A safety copy is kept first, and nothing restarts."
        : running ? `Branch ${versionLabel(running, level)}. The window refreshes itself, running work moves across to the new engine, and nothing restarts. You only see a small “Updated” note. The desktop shell updates the next time you open Branch.`
        : "Checks for a new verified Branch release."}
    </Status>
    <Sec title="Updating">
      <Ctl title="Apply updates automatically" off={auto.off}>
        <Switch label="Apply updates automatically" checked={autoApply}
          disabled={auto.busy !== null} onChange={on => void auto.set("autoApplyUpdates", on)} />
      </Ctl>
      <Ctl title="Check for updates"><Btn sm disabled={busy !== ""} onClick={() => void run("check")}>{busy === "check" ? "Checking…" : busy ? "Working…" : "Check now"}</Btn></Ctl>
      {data.status?.phase === "available" ? <Ctl title="Update available"><Btn disabled={busy !== ""} onClick={() => void run("stage")}>Download update</Btn></Ctl> : null}
      {stagedWaiting && install ? <Ctl title="Staged update" sub="Applies in place. A safety copy is kept first, and nothing restarts.">
        <Btn pri sm disabled={installRequested} onClick={requestInstall}>{installRequested ? "Updating…" : "Apply now, in place"}</Btn>
      </Ctl> : null}
      {stagedWaiting ? <Hint>{autoApply
        ? "Branch applies it by itself the next time no Trunk is working."
        : "Branch won’t apply a staged update until you choose. Apply now, in place applies it."}</Hint>
        : <Hint>Branch checks every 10 minutes.</Hint>}
      <UndoLastUpdate gatewayUrl={engine.gatewayUrl} bridge={bridge} />
    </Sec>
    <Sec title="About"><WhatsNewRow /></Sec>
  </Page>;
}

/** An older Branch Agent app has no Check now bridge, but it still checks every hour and stages updates by itself.
 *  The page still uses Branch's version; a window connected elsewhere keeps its own reason. */
function HourlyUpdates({ title, engine, level, reason }: Pick<SettingsPageProps, "title" | "engine" | "level"> & { reason?: string }) {
  const version = useBranchVersion(engine.gatewayUrl);
  const sys = useLive<RecordValue>(engine, "system.info", {}, []);
  const os = OS[str(rec(sys.data).platform)] ?? str(rec(sys.data).osLabel);
  const lede = version ? `Branch ${versionLabel(version, level)}${os ? ` on ${os}` : ""}.` : "Updates for Branch on this computer.";
  return <Page title={title} lede={lede}>
    <div className="s2-keeper"><KeeperMark size={64} /></div>
    {reason
      ? <Status tone="warn" title="Updates aren’t available here">{reason}</Status>
      : <Status title={version ? `You have Branch ${versionLabel(version, level)}` : "Branch on this computer"}>{DESKTOP_CHECKS_HOURLY}</Status>}
    <Sec title="Updating">
      <Ctl title="Check for updates" off={reason ? undefined : MANUAL_UPDATE_UNSUPPORTED}><Btn sm disabled>Check now</Btn></Ctl>
      <Hint>A downloaded update takes effect when Branch restarts.</Hint>
    </Sec>
  </Page>;
}

/** The headline. Up to date (or a staged copy that is the running version, B-052) reads plainly with the check's time. */
function statusLine(status: ComponentUpdateStatus | null, level: SettingsPageProps["level"], checkedAt: number | null, now: number): string {
  if (!status) return "Reading desktop update status…";
  if (status.phase === "available") return "A Branch update is ready";
  if (status.phase === "current" || status.phase === "staged") return latestVersionLine(checkedAt, now);
  if (status.phase === "checking") return "Checking…";
  if (status.phase === "staging") return "Downloading and checking the update…";
  return status.currentVersion ? `Branch ${versionLabel(status.currentVersion, level)}` : "Check for updates";
}

/** The preview's version line under "Undo the last update": "0.19.4 installed Sep 20." (month and day in the owner's locale). */
export function undoVersionLine(value: UndoAvailability | null, locale?: string | string[]): string | null {
  if (!value?.version || value.installedAt == null) return null;
  return `${versionParts(value.version).short} installed ${new Date(value.installedAt).toLocaleDateString(locale, { month: "short", day: "numeric" })}.`;
}

/** Preview Settings › Updating "Undo the last update": Undo, over the installed version's line. The row is there only while
 *  Undo can run (the previous engine's 3-day probation, Private #983); after that, or once it is pruned, it goes. */
function UndoLastUpdate({ gatewayUrl, bridge }: { gatewayUrl?: string; bridge: ComponentUpdates }) {
  const { value } = useDesktopUndoAvailability(gatewayUrl);
  const [undoing, setUndoing] = useState(false);
  useEffect(() => { if (!undoing) return; const timer = setTimeout(() => setUndoing(false), 60_000); return () => clearTimeout(timer); }, [undoing]);
  const line = undoVersionLine(value);
  const undo = bridge.undo;
  if (!undo || !undoOpen(value) || !line) return null;
  return <Ctl title="Undo the last update" sub={line}>
    <Btn sm disabled={undoing} onClick={() => { setUndoing(true); undo(); }}>Undo</Btn>
  </Ctl>;
}
