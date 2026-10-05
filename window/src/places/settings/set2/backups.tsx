// Settings › Backups: where the scheduled backup goes (a folder here, or a private Git repository's `backups`
// branch), how often it runs, "Back up now" and the last result. The engine's backup.status / backup.schedule.set /
// backup.schedule.clear / backup.run; every backup made here leaves out passwords, keys and sign-ins.
import { useEffect, useState } from "react";
import type { SettingsPageProps } from "../index";
import { Acts, Btn, Ctl, Field, Page, Pill, Sec, Seg, type RowEntry } from "../kit";
import { list } from "../adapter";
import { CallLine, rec, str, useCall, useLive, when, type RecordValue } from "./common";

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const LEDE = "A copy of your conversations, memory, Trunk workspaces (Library documents included) and settings, on a schedule you choose. Passwords, keys and sign-ins are never included.";
const GIT_HINT = "Use a private repository, for example github.com/KeepOak/Branch-Agent-Private. Branch pushes to its backups branch with your Git sign-in.";

export const ROWS: RowEntry[] = [
  ["Where backups go", "Where", 0], ["How often", "When", 0], ["Back up now", "When", 0], ["Last backup", "When", 0],
].map(([title, sec, lv]) => ({ page: "backups", title: String(title), sec: String(sec), lv: lv as 0 | 1 | 2, words: "backup copy restore git repository folder schedule" }));

type Kind = "folder" | "git";
type Destination = { kind: "folder"; path: string } | { kind: "git"; url: string };

/** The Settings-managed schedule: the Git one (backup.status lists one per mode). */
function gitSchedule(status: RecordValue | undefined): RecordValue | undefined {
  return list(rec(status).schedules).find((s) => s.mode === "git");
}
function destinationOf(schedule: RecordValue | undefined): Destination | undefined {
  if (!schedule) return undefined;
  if (schedule.push === true) return str(schedule.remote) ? { kind: "git", url: str(schedule.remote) } : undefined;
  return { kind: "folder", path: str(schedule.target) };
}
function everyOf(schedule: RecordValue | undefined): string {
  if (!schedule || schedule.enabled !== true) return "off";
  return schedule.everyMs === WEEK ? "week" : schedule.everyMs === DAY ? "day" : String(schedule.everyMs);
}

export function BackupsPage(props: SettingsPageProps) {
  const status = useLive<RecordValue>(props.engine, "backup.status", {}, ["cron"]);
  const schedule = gitSchedule(status.data);
  const saved = destinationOf(schedule);
  const save = useCall(); const run = useCall();
  const set = async (destination: Destination, every: string) => {
    const everyMs = every === "off" ? Number(schedule?.everyMs) || DAY : every === "week" ? WEEK : every === "day" ? DAY : Number(every);
    await props.engine.request("backup.schedule.set", { destination, everyMs, enabled: every !== "off" });
    await status.reload();
  };
  return (
    <Page title={props.title} lede={LEDE}>
      {status.error ? <p className="hint s2-err" role="alert">{status.error}</p> : null}
      <Sec title="Where">
        <Where saved={saved} busy={save.busy} onSave={(d) => void save.run(() => set(d, saved ? everyOf(schedule) : "day"), () => "Saved.")}
          onForget={() => void save.run(async () => { await props.engine.request("backup.schedule.clear", {}); await status.reload(); }, () => "Branch no longer backs up there.")} />
        <CallLine call={save} />
      </Sec>
      <Sec title="When">
        <Ctl title="How often" sub={schedule?.enabled === true && schedule.nextRunAtMs ? `Next: ${when(schedule.nextRunAtMs)}` : saved ? "Off. Back up now still works." : "Choose where backups go first."}>
          <Seg label="How often" value={everyOf(schedule)} disabled={!saved || save.busy}
            options={[{ id: "off", label: "Off" }, { id: "day", label: "Every day" }, { id: "week", label: "Every week" },
              ...(["off", "day", "week"].includes(everyOf(schedule)) ? [] : [{ id: everyOf(schedule), label: `Every ${Math.round(Number(schedule?.everyMs) / 3_600_000)} hours` }])]}
            onChange={(v) => { if (saved) void save.run(() => set(saved, v)); }} />
        </Ctl>
        <Ctl title="Back up now" sub="Runs in the background; the result shows below.">
          <Btn sm disabled={!saved || run.busy} onClick={() => void run.run(async () => rec(await props.engine.request("backup.run", {})), (r) => r.started === true ? "Backing up…" : r.reason === "already-running" ? "A backup is already running." : `Didn’t start: ${str(r.reason) || "the engine declined"}.`)}>Back up now</Btn>
        </Ctl>
        <CallLine call={run} />
        <LastBackup status={status.data} repository={str(schedule?.target)} />
      </Sec>
    </Page>
  );
}

function Where({ saved, busy, onSave, onForget }: { saved?: Destination; busy: boolean; onSave: (d: Destination) => void; onForget: () => void }) {
  const [kind, setKind] = useState<Kind>(saved?.kind ?? "git");
  const savedValue = saved ? (saved.kind === "git" ? saved.url : saved.path) : "";
  const [value, setValue] = useState(savedValue);
  const savedKind = saved?.kind;
  useEffect(() => { if (savedKind) { setKind(savedKind); setValue(savedValue); } }, [savedKind, savedValue]);
  const destination: Destination = kind === "git" ? { kind, url: value.trim() } : { kind, path: value.trim() };
  const changed = value.trim() !== "" && (kind !== saved?.kind || value.trim() !== savedValue);
  return (
    <>
      <Ctl title="Where backups go" sub={kind === "git" ? GIT_HINT : "A private folder on this computer, outside Branch’s own data. It becomes a Git history of your backups."}>
        <Seg label="Where backups go" value={kind} disabled={busy} options={[{ id: "git", label: "A Git repository" }, { id: "folder", label: "A folder on this computer" }]} onChange={(v) => setKind(v as Kind)} />
      </Ctl>
      <Ctl title={kind === "git" ? "Repository address" : "Folder"} stack>
        <Field wide label={kind === "git" ? "Repository address" : "Folder"} value={value} disabled={busy}
          placeholder={kind === "git" ? "https://github.com/you/private-repo.git" : "C:\\Users\\you\\Backups\\Branch"} onCommit={setValue} />
        <Acts>
          <Btn sm pri disabled={busy || !changed} onClick={() => onSave(destination)}>Save</Btn>
          {saved ? <Btn sm ghost disabled={busy} onClick={onForget}>Stop backing up here</Btn> : null}
        </Acts>
      </Ctl>
    </>
  );
}

function LastBackup({ status, repository }: { status?: RecordValue; repository: string }) {
  const t = list(rec(status).targets).find((x) => x.kind === "git" && str(x.target) === repository);
  const latest = rec(t?.latest);
  if (!repository || !t) return <Ctl title="Last backup" sub={repository ? "None yet." : "Nothing backed up yet."} />;
  const ok = latest.status === "ok";
  const commit = str(latest.target);
  const what = !ok ? str(latest.error) || "Failed." : latest.pushFailed === true ? `Saved here, but sending it to the repository failed: ${str(latest.error)}` : commit ? `Saved as ${commit.slice(0, 10)}.` : "Nothing changed since the one before.";
  const lastOk = rec(t.latestOk);
  return (
    <Ctl title="Last backup" sub={<>{when(latest.createdAt)} · {what}{!ok && lastOk.createdAt ? ` Last success: ${when(lastOk.createdAt)}.` : ""}</>}>
      <Pill tone={ok ? (latest.pushFailed === true ? "warn" : "ok") : "bad"}>{ok ? (latest.pushFailed === true ? "Not sent" : "Succeeded") : "Failed"}</Pill>
    </Ctl>
  );
}
