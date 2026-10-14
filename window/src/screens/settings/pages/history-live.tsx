// Settings › History & backups: the controls the R1 page draws itself (slots.ts controls). Each reuses the Classic
// page's own logic on the same engine calls, so every working Classic control keeps working here (R1 README rule 6):
// Backups (set2/backups.tsx: backup.status, backup.schedule.set / clear, backup.run), the overnight memory cleanup's
// diary, fill-in and maintenance (set2/seasons.tsx: doctor.memory.*, memory.sessionBackfill.*), Every change
// (set2/self.tsx: branch.changes.list) and Your settings' Export and Import (set2/self.tsx).
import { useEffect, useState, type ReactNode } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Coming } from "../../../glass/coming";
import { list, record, type RecordValue } from "../../../places/settings/adapter";
import { useConfig } from "../../../places/settings/kit";
import { DAY, WEEK, MEDIA_FILE_MB, MEDIA_TOTAL_MB, destinationOf, gitSchedule, lastBackup, type Destination, type MediaLimits } from "../../../places/settings/set2/backups";
import { str, useLive, when } from "../../../places/settings/set2/common";
import { BackfillDialog, DiaryDialog } from "../../../places/settings/set2/seasons";
import { ImportDialog, SOURCE, exportSettings } from "../../../places/settings/set2/self";
import { Segmented, Toggle } from "../RowView";
import type { SlotControlProps } from "../slots";
import { useRead } from "./accounts-live";
import { Failed, Needs, useFailure } from "./appearance-live";
import { CLEANUP_CODE, NEVER_DIES } from "./history";

const Line = ({ children, bad }: { children: ReactNode; bad?: boolean }) => <small className={"r1s-msg g-label" + (bad ? " r1s-bad" : "")} role={bad ? "status" : undefined} data-lines>{children}</small>;
const Val = ({ children }: { children: ReactNode }) => <span className="r1s-val g-label" data-lines>{children}</span>;
/** A button that keeps the attributes <Coming> gives it (data-need), so the control stays declared. */
const Btn = ({ children, disabled, onClick, ...rest }: { children: ReactNode; disabled?: boolean; onClick: () => void }) =>
  <button type="button" className="r1s-btn" disabled={disabled} onClick={onClick} {...rest}>{children}</button>;

/** The backup schedule Settings manages (the Git one), shared by every Backups row: one read, one way to save. */
function useBackups(engine: WindowEngine) {
  const status = useRead(engine, "backup.status");
  const schedule = gitSchedule(status.data);
  const saved = destinationOf(schedule);
  const media: MediaLimits = {
    ...(typeof schedule?.mediaMaxFileMb === "number" ? { mediaMaxFileMb: schedule.mediaMaxFileMb } : {}),
    ...(typeof schedule?.mediaMaxTotalMb === "number" ? { mediaMaxTotalMb: schedule.mediaMaxTotalMb } : {}),
  };
  const every = Number(schedule?.everyMs) || DAY;
  /** Classic's save: the destination, how often (ms) and whether it runs, with the media limits. */
  const set = async (destination: Destination, next: { everyMs?: number; enabled?: boolean; limits?: MediaLimits } = {}) => {
    await engine.request("backup.schedule.set", { destination, everyMs: next.everyMs ?? every, enabled: next.enabled ?? schedule?.enabled === true, ...(next.limits ?? media) });
    await status.reload();
  };
  return { status, schedule, saved, media, every, enabled: schedule?.enabled === true, set };
}
const BACKUP_NEED = ["backup.status", "backup.schedule.set"];

/** Back up on a schedule: on runs it every day (or as often as it last did); off keeps where it goes. */
export function BackupSchedule({ engine, row }: SlotControlProps) {
  const b = useBackups(engine);
  const [failed, run] = useFailure();
  return <>
    <Needs engine={engine} need={BACKUP_NEED} where={row.label ?? ""}>
      <span className="r1s-own-ctl"><Toggle label="Back up on a schedule" on={b.enabled} disabled={!b.saved} onChange={(on) => { if (b.saved) void run(() => b.set(b.saved!, { enabled: on })); }} /></span>
    </Needs>
    {!b.saved && !b.status.loading ? <Line>Choose where backups go first.</Line> : null}
    {b.status.error ? <Line bad>{b.status.error}</Line> : null}
    <Failed text={failed} />
  </>;
}

/** How often: every night or every week (an engine schedule of another length shows as itself). */
export function BackupOften({ engine, row }: SlotControlProps) {
  const b = useBackups(engine);
  const [failed, run] = useFailure();
  const value = b.every === WEEK ? "week" : b.every === DAY ? "day" : String(b.every);
  const options = [{ v: "day", label: "Every night" }, { v: "week", label: "Every week" }, ...(value === "day" || value === "week" ? [] : [{ v: value, label: `Every ${Math.round(b.every / 3_600_000)} hours` }])];
  return <>
    <Needs engine={engine} need={BACKUP_NEED} where={row.label ?? ""}>
      <span className="r1s-own-ctl"><Segmented label="How often" value={value} options={options} disabled={!b.saved} onChange={(v) => { if (b.saved) void run(() => b.set(b.saved!, { everyMs: v === "week" ? WEEK : v === "day" ? DAY : Number(v) })); }} /></span>
    </Needs>
    <Line>{b.enabled && b.schedule?.nextRunAtMs ? `Next: ${when(b.schedule.nextRunAtMs)}` : b.saved ? "Off. Back up now still works." : "Choose where backups go first."}</Line>
    <Failed text={failed} />
  </>;
}

/** Where backups go: a private Git repository or a folder here, its address, Save and Stop backing up here. */
export function BackupWhere({ engine, row }: SlotControlProps) {
  const b = useBackups(engine);
  const [failed, run] = useFailure();
  const [busy, setBusy] = useState(false);
  const saved = b.saved;
  const savedValue = saved ? (saved.kind === "git" ? saved.url : saved.path) : "";
  const [kind, setKind] = useState<"git" | "folder">(saved?.kind ?? "git");
  const [value, setValue] = useState(savedValue);
  useEffect(() => { if (saved?.kind) { setKind(saved.kind); setValue(savedValue); } }, [saved?.kind, savedValue]);
  const destination: Destination = kind === "git" ? { kind, url: value.trim() } : { kind, path: value.trim() };
  const changed = value.trim() !== "" && (kind !== saved?.kind || value.trim() !== savedValue);
  const go = (fn: () => Promise<unknown>) => { setBusy(true); void run(fn).finally(() => setBusy(false)); };
  const label = kind === "git" ? "Repository address" : "Folder";
  return <>
    <Needs engine={engine} need={[...BACKUP_NEED, "backup.schedule.clear"]} where={row.label ?? ""}>
      <div className="r1s-own-ctl">
        <Segmented label="Where backups go" value={kind} disabled={busy} options={[{ v: "git", label: "A Git repository" }, { v: "folder", label: "A folder on this computer" }]} onChange={(v) => setKind(v as "git" | "folder")} />
        <input className="r1s-inp" aria-label={label} value={value} disabled={busy} placeholder={kind === "git" ? "https://github.com/you/branch-backups.git" : "C:\\Users\\you\\Backups\\Branch"} onChange={(e) => setValue(e.target.value)} />
        <span className="r1s-acts">
          <Btn disabled={busy || !changed} onClick={() => go(() => (saved ? b.set(destination) : b.set(destination, { everyMs: DAY, enabled: true })))}>Save</Btn>
          {saved ? <Btn disabled={busy} onClick={() => go(async () => { await engine.request("backup.schedule.clear", {}); await b.status.reload(); })}>Stop backing up here</Btn> : null}
        </span>
      </div>
    </Needs>
    <Line>{kind === "git" ? "Branch pushes to its backups branch with your Git sign-in." : "It becomes a Git history of your backups."}</Line>
    <Failed text={failed} />
  </>;
}

/** Back up now: backup.run, then what the engine said. */
export function BackupNow({ engine, row }: SlotControlProps) {
  const b = useBackups(engine);
  const [note, setNote] = useState("");
  const [failed, run] = useFailure();
  const [busy, setBusy] = useState(false);
  const start = () => { setBusy(true); setNote(""); void run(async () => {
    const r = record(await engine.request("backup.run", {}));
    setNote(r.started === true ? "Backing up…" : r.reason === "already-running" ? "A backup is already running." : `Didn’t start: ${str(r.reason) || "the engine declined"}.`);
    await b.status.reload();
  }).finally(() => setBusy(false)); };
  return <>
    <Needs engine={engine} need={["backup.run"]} where={row.label ?? ""}><Btn disabled={!b.saved || busy} onClick={start}>Back up now</Btn></Needs>
    {note ? <Line>{note}</Line> : null}
    <Failed text={failed} />
  </>;
}

/** Last backup: when, what happened, and whether it succeeded, with the preview's Restore… (Coming until a copy can be
 *  put back from here). */
export function LastBackup({ engine }: SlotControlProps) {
  const b = useBackups(engine);
  const last = lastBackup(b.status.data, str(b.schedule?.target));
  return <>
    <span className="r1s-own-ctl"><Val>{last.pill ? last.pill.label : "None"}</Val>
      <Coming engine={engine} need="backup.restore" unwired reason="Restoring a copy comes in a later update." where="Restore…"><button type="button" className="r1s-btn" disabled>Restore…</button></Coming></span>
    <Line bad={last.pill?.tone === "bad"}>{last.sub}</Line>
  </>;
}

function MediaLimit({ engine, row, field, fallback }: SlotControlProps & { field: keyof MediaLimits; fallback: number }) {
  const b = useBackups(engine);
  const [failed, run] = useFailure();
  const shown = b.media[field] === undefined ? "" : String(b.media[field]);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    if (!b.saved || text === shown) return;
    const n = Number(text);
    if (text.trim() !== "" && !(Number.isFinite(n) && n >= 1)) return setText(shown);
    const next: MediaLimits = { ...b.media };
    if (text.trim() === "") delete next[field]; else next[field] = Math.round(n);
    void run(() => b.set(b.saved!, { limits: next }));
  };
  return <>
    <Needs engine={engine} need={BACKUP_NEED} where={row.label ?? ""}>
      <span className="r1s-own-ctl">
        <input className="r1s-inp" type="number" min={1} aria-label={row.label} value={text} placeholder={String(fallback)} disabled={!b.saved} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); }} />
        <span className="r1s-unit g-label">MB</span>
      </span>
    </Needs>
    <Failed text={failed} />
  </>;
}
export const MediaFile = (props: SlotControlProps) => <MediaLimit {...props} field="mediaMaxFileMb" fallback={MEDIA_FILE_MB} />;
export const MediaAll = (props: SlotControlProps) => <MediaLimit {...props} field="mediaMaxTotalMb" fallback={MEDIA_TOTAL_MB} />;

const agentOf = (engine: WindowEngine) => engine.agentId ?? "";

/** Rings diary: Classic's dialog of what the overnight cleanup changed (doctor.memory.dreamDiary). */
export function ReadDiary({ engine, row }: SlotControlProps) {
  const [open, setOpen] = useState(false);
  return <>
    <Needs engine={engine} need={["doctor.memory.dreamDiary"]} where={row.label ?? ""}><Btn onClick={() => setOpen(true)}>Read it</Btn></Needs>
    {open ? <DiaryDialog engine={engine} agent={agentOf(engine)} onClose={() => setOpen(false)} /> : null}
  </>;
}

/** Fill in from past conversations: Classic's preview-then-write dialog (memory.sessionBackfill.*). */
export function FillIn({ engine, row }: SlotControlProps) {
  const [open, setOpen] = useState(false);
  const agent = agentOf(engine);
  return <>
    <Needs engine={engine} need={["memory.sessionBackfill.preview", "memory.sessionBackfill.apply", "memory.sessionBackfill.rollback"]} where={row.label ?? ""}><Btn disabled={!agent} onClick={() => setOpen(true)}>Choose…</Btn></Needs>
    {!agent ? <Line>Needs a Trunk to fill in for.</Line> : null}
    {open ? <BackfillDialog engine={engine} agent={agent} onClose={() => setOpen(false)} /> : null}
  </>;
}

/** A terminal command behind the cleanup, with Copy. */
export function CleanupCode({ row }: SlotControlProps) {
  const code = CLEANUP_CODE[row.id] ?? "";
  const [copied, setCopied] = useState(false);
  return <span className="r1s-own-ctl" data-local="">
    <code className="r1s-val">{code}</code>
    <Btn onClick={() => void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => undefined)}>{copied ? "Copied" : "Copy"}</Btn>
  </span>;
}

/** The cleanup's maintenance actions (doctor.memory.*), each with what it did and the notes it holds. */
const ACTIONS: Record<string, { method: string; button: string; note: (r: RecordValue) => string }> = {
  "history.snapshots.fill-notes": { method: "doctor.memory.backfillDreamDiary", button: "Fill in", note: (r) => `Wrote ${str(r.written) || "0"} entries from ${str(r.scannedFiles) || "0"} notes.` },
  "history.snapshots.reset": { method: "doctor.memory.resetDreamDiary", button: "Remove", note: (r) => `Removed ${str(r.removedEntries) || "0"} entries.` },
  "history.snapshots.dedupe": { method: "doctor.memory.dedupeDreamDiary", button: "Remove repeats", note: (r) => `Removed ${str(r.removedEntries) || str(r.removed) || "0"} repeats.` },
  "history.snapshots.repair": { method: "doctor.memory.repairRingsArtifacts", button: "Repair", note: (r) => (r.changed === true ? `Repaired. The old files are in ${str(r.archiveDir)}.` : "Nothing needed repair.") },
};
export function CleanupAction({ engine, row }: SlotControlProps) {
  const action = ACTIONS[row.id];
  const agent = agentOf(engine);
  const params = agent ? { agentId: agent } : {};
  const status = useRead(engine, "doctor.memory.status", params);
  const rings = record(status.data?.rings);
  const [note, setNote] = useState("");
  const [failed, run] = useFailure();
  const [busy, setBusy] = useState(false);
  if (!action) return null;
  const go = () => { setBusy(true); setNote(""); void run(async () => { setNote(action.note(record(await engine.request(action.method, params)))); await status.reload(); }).finally(() => setBusy(false)); };
  return <>
    <Needs engine={engine} need={[action.method]} where={row.label ?? ""}><Btn disabled={busy} onClick={go}>{action.button}</Btn></Needs>
    {row.id === "history.snapshots.fill-notes" ? <Line>{`${str(rings.shortTermCount) || "0"} notes waiting · ${str(rings.promotedToday) || "0"} kept today · ${str(rings.promotedTotal) || "0"} kept in all`}</Line> : null}
    {note ? <Line>{note}</Line> : null}
    {rings.storeError && row.id === "history.snapshots.repair" ? <Line bad>{str(rings.storeError)}</Line> : null}
    <Failed text={failed} />
  </>;
}

/** What the engine does when it stops (Classic's Never dies). */
export function NeverDies({ row }: SlotControlProps) {
  return <Val>{NEVER_DIES[row.id] ?? ""}</Val>;
}

/** Every change: the engine's record of changes to its setup, newest first (branch.changes.list). */
export function EveryChange({ engine, row }: SlotControlProps) {
  const changes = useLive<RecordValue>(engine, "branch.changes.list", { limit: 50 }, ["config"]);
  const entries = list(record(changes.data).entries);
  return (
    <Needs engine={engine} need={["branch.changes.list"]} where={row.label ?? ""}>
      <div className="r1s-own-ctl">
        {changes.error ? <Line bad>{changes.error}</Line> : null}
        {changes.data && !entries.length ? <Line>No changes yet.</Line> : null}
        {entries.length ? (
          <ul className="r1s-items">
            {entries.map((e) => (
              <li key={str(e.id)} className="r1s-item" data-bad={e.invalid === true || undefined}>
                <span className="r1s-item-t g-label">{[SOURCE[str(e.source)], str(e.summary)].filter(Boolean).join(": ")}</span>
                <small className="g-label">{when(e.at)}{Array.isArray(e.changedPaths) && e.changedPaths.length ? ` · ${e.changedPaths.map(String).slice(0, 3).join(", ")}` : ""}</small>
                {e.kind === "config-write" ? <Coming engine={engine} need="engine: rolling back a settings change" unwired reason="Rolling back a change comes in a later update." where="Roll back">
                  <button type="button" className="r1s-link" disabled>Roll back</button></Coming> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Needs>
  );
}

/** Export: every setting as one file (Classic Your settings › Export). */
export function ExportSettings({ engine, row }: SlotControlProps) {
  const config = useConfig(engine);
  return <Needs engine={engine} need={["config.get"]} where={row.label ?? ""}><Btn disabled={config.loading} onClick={() => exportSettings(config.cfg)}>Export</Btn></Needs>;
}

/** Import: a settings file, each change shown before it is applied (Classic Your settings › Import). */
export function ImportSettings({ engine, row }: SlotControlProps) {
  const config = useConfig(engine);
  const [incoming, setIncoming] = useState<{ name: string; raw: string } | null>(null);
  return <>
    <Needs engine={engine} need={["config.get", "config.patch"]} where={row.label ?? ""}>
      <label className="r1s-btn">Choose a file<input type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then((raw) => setIncoming({ name: f.name, raw })); }} /></label>
    </Needs>
    {incoming ? <ImportDialog engine={engine} config={config} file={incoming} onClose={() => setIncoming(null)} /> : null}
  </>;
}

/** Where your data lives: the folder the engine reports; moving it needs the Branch app. */
export function DataFolder({ engine, row }: SlotControlProps) {
  const sys = record(useLive<RecordValue>(engine, "system.info", {}, []).data);
  return <span className="r1s-own-ctl">
    {str(sys.diskPath) ? <code className="r1s-val">{str(sys.diskPath)}</code> : null}
    <Coming engine={engine} need="desktop: moving Branch's data" unwired reason="Moving your data needs the Branch app." where={row.label}>
      <button type="button" className="r1s-btn" disabled>Move…</button>
    </Coming>
  </span>;
}
