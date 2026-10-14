// Settings › Learning & self-updates: the controls the R1 page draws itself (slots.ts controls), each on the engine
// calls Classic About Branch (set2/self.tsx) and Seasons (set2/seasons.tsx) make: what it learned
// (skills.proposals.list, doctor.memory.status), the overnight cleanup's notes (doctor.memory.*), the diary's model
// (models.list, config), who is connected (system-presence, users.list), Check Branch (health) and Restart the engine
// (gateway.restart.request). The facts Classic states are drawn as values.
import { useState, type ReactNode } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { Coming } from "../../../glass/coming";
import { list, record, type RecordValue } from "../../../places/settings/adapter";
import { useConfig } from "../../../places/settings/kit";
import { span, str, useLive, when } from "../../../places/settings/set2/common";
import { WeighDialog, changes } from "../../../places/settings/set2/seasons";
import { CheckDialog, clientName } from "../../../places/settings/set2/self";
import { Dialog } from "../../../shell/Dialog";
import type { SlotControlProps } from "../slots";
import { useRead } from "./accounts-live";
import { Failed, Needs, useFailure } from "./appearance-live";
import { CODE, FACTS } from "./learning";

const RINGS = "plugins.entries.memory-core.config.rings";
const Line = ({ children, bad }: { children: ReactNode; bad?: boolean }) => <small className={"r1s-msg g-label" + (bad ? " r1s-bad" : "")} role={bad ? "status" : undefined} data-lines>{children}</small>;
const Val = ({ children }: { children: ReactNode }) => <span className="r1s-val g-label" data-lines>{children}</span>;
/** A button that keeps the attributes <Coming> gives it (data-need), so the control stays declared. */
const Btn = ({ children, disabled, onClick, ...rest }: { children: ReactNode; disabled?: boolean; onClick: () => void }) =>
  <button type="button" className="r1s-btn" disabled={disabled} onClick={onClick} {...rest}>{children}</button>;
const agentParams = (engine: WindowEngine) => (engine.agentId ? { agentId: engine.agentId } : {});

/** A fact Classic states as a value. */
export function Fact({ row }: SlotControlProps) {
  return <Val>{FACTS[row.id] ?? ""}</Val>;
}

/** A terminal command, with Copy. */
export function Command({ row }: SlotControlProps) {
  const code = CODE[row.id] ?? "";
  const [copied, setCopied] = useState(false);
  return <span className="r1s-own-ctl" data-local="">
    <code className="r1s-val">{code}</code>
    <Btn onClick={() => void navigator.clipboard?.writeText(code).then(() => setCopied(true), () => undefined)}>{copied ? "Copied" : "Copy"}</Btn>
  </span>;
}

/** What it learned: what the overnight cleanup kept and the skills it learned or suggested, newest first. */
export function Learned({ engine, row }: SlotControlProps) {
  const params = agentParams(engine);
  const status = useRead(engine, "doctor.memory.status", params);
  const proposals = useLive<RecordValue>(engine, "skills.proposals.list", params, ["skills"]);
  const all = changes(record(status.data?.rings), list(record(proposals.data).proposals));
  return (
    <Needs engine={engine} need={["skills.proposals.list", "doctor.memory.status"]} where={row.label ?? ""}>
      <div className="r1s-own-ctl">
        {status.error ? <Line bad>{status.error}</Line> : null}
        {all.length ? (
          <ul className="r1s-items">
            {all.map((c) => (
              <li key={c.id} className="r1s-item">
                <span className="r1s-item-t g-label">{c.text}</span>
                <small className="g-label">{when(c.at)}{c.note ? ` · ${c.note}` : ""}</small>
                <Coming engine={engine} need="engine: undoing a learned change" unwired reason="Undoing a change comes in a later update." where="Undo"><button type="button" className="r1s-link" disabled>Undo</button></Coming>
              </li>
            ))}
          </ul>
        ) : <Line>No changes right now.</Line>}
      </div>
    </Needs>
  );
}

/** Clear replayed notes (doctor.memory.resetGroundedShortTerm). */
export function ClearReplayed({ engine, row }: SlotControlProps) {
  const params = agentParams(engine);
  const status = useRead(engine, "doctor.memory.status", params);
  const [note, setNote] = useState("");
  const [failed, run] = useFailure();
  const [busy, setBusy] = useState(false);
  const go = () => { setBusy(true); setNote(""); void run(async () => {
    const r = record(await engine.request("doctor.memory.resetGroundedShortTerm", params));
    setNote(`Cleared ${str(r.removedShortTermEntries) || "0"} notes.`);
    await status.reload();
  }).finally(() => setBusy(false)); };
  return <>
    <Needs engine={engine} need={["doctor.memory.resetGroundedShortTerm"]} where={row.label ?? ""}><Btn disabled={busy} onClick={go}>Clear</Btn></Needs>
    {note ? <Line>{note}</Line> : null}
    <Failed text={failed} />
  </>;
}

/** What Rings is weighing: Classic's list of notes waiting to be kept. */
export function Weighing({ engine, row }: SlotControlProps) {
  const status = useRead(engine, "doctor.memory.status", agentParams(engine));
  const [open, setOpen] = useState(false);
  return <>
    <Needs engine={engine} need={["doctor.memory.status"]} where={row.label ?? ""}><Btn disabled={!status.data} onClick={() => setOpen(true)}>Review</Btn></Needs>
    {open ? <WeighDialog status={record(status.data?.rings)} onClose={() => setOpen(false)} /> : null}
  </>;
}

/** Model that writes the diary: each Trunk's own, or a model the engine lists. */
export function DiaryModel({ engine, row }: SlotControlProps) {
  const config = useConfig(engine);
  const models = useLive<RecordValue>(engine, "models.list", {}, []);
  const [failed, run] = useFailure();
  const value = str(config.get(`${RINGS}.model`));
  const opts = list(record(models.data).models).filter((m) => m.available !== false).map((m) => ({ id: `${str(m.provider)}/${str(m.id)}`, label: str(m.name) || str(m.id) }));
  if (value && !opts.some((o) => o.id === value)) opts.push({ id: value, label: value });
  return <>
    <Needs engine={engine} need={["models.list", "config.get", "config.patch"]} where={row.label ?? ""}>
      <select className="r1s-inp" aria-label="Model that writes the diary" value={value} disabled={config.loading} onChange={(e) => void run(() => config.set(`${RINGS}.model`, e.target.value || null))}>
        <option value="">Each Trunk’s own model</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </Needs>
    <Failed text={failed} />
  </>;
}

/** Process names: the engine's process as the system shows it. */
export function ProcessNames({ engine }: SlotControlProps) {
  const sys = record(useLive<RecordValue>(engine, "system.info", {}, []).data);
  return <Val>{sys.pid ? `node · process ${str(sys.pid)}` : ""}</Val>;
}

/** Connected now: windows, terminals, phones and chat apps on this engine (system-presence), with See them. */
export function ConnectedNow({ engine, row }: SlotControlProps) {
  const presence = useLive<unknown>(engine, "system-presence", {}, ["presence"]);
  const [open, setOpen] = useState(false);
  const clients = list(presence.data);
  const names = [...new Set(clients.map(clientName))];
  return <>
    <Needs engine={engine} need={["system-presence"]} where={row.label ?? ""}><Btn disabled={!presence.data} onClick={() => setOpen(true)}>See them</Btn></Needs>
    {clients.length ? <Line>{`${clients.length} on one engine: ${names.join(", ")}.`}</Line> : null}
    {open ? (
      <Dialog title="Connected now" onClose={() => setOpen(false)}>
        {clients.length ? <ul className="r1s-items">{clients.map((p, i) => <li className="r1s-item" key={str(p.connectionId) || i}><span className="r1s-item-t g-label">{clientName(p)}</span>
          <small className="g-label">{[str(p.platform), str(p.version), p.lastInputSeconds !== undefined ? `active ${span(Number(p.lastInputSeconds) * 1000) || "now"} ago` : ""].filter(Boolean).join(" · ")}</small></li>)}</ul>
          : <p className="g-label">Nothing else is connected.</p>}
      </Dialog>
    ) : null}
  </>;
}

/** People on this engine (users.list). */
export function PeopleHere({ engine, row }: SlotControlProps) {
  const users = useLive<RecordValue>(engine, "users.list", {}, []);
  const people = list(record(users.data).profiles).filter((p) => !p.mergedInto).map((p) => str(p.displayName)).filter(Boolean);
  return <Needs engine={engine} need={["users.list"]} where={row.label ?? ""}><span className="r1s-val g-label" data-lines>{people.join(", ") || "—"}</span></Needs>;
}

/** Tasks at once: the engine's cap on Trunks working at once, or none. */
export function TasksAtOnce({ engine }: SlotControlProps) {
  const config = useConfig(engine);
  const max = config.get("agents.defaults.maxConcurrent");
  return <Val>{typeof max === "number" ? `Up to ${max}` : "As many as this computer allows"}</Val>;
}

/** Check and fix: Classic's read-only check of the engine, chat apps and memory search. */
export function CheckBranch({ engine, row }: SlotControlProps) {
  const [open, setOpen] = useState(false);
  return <>
    <Needs engine={engine} need={["health"]} where={row.label ?? ""}><Btn onClick={() => setOpen(true)}>Check and fix</Btn></Needs>
    {open ? <CheckDialog engine={engine} onClose={() => setOpen(false)} /> : null}
  </>;
}

/** Restart the engine (gateway.restart.request); the window reconnects by itself. */
export function RestartEngine({ engine, row }: SlotControlProps) {
  const [failed, run] = useFailure();
  const [busy, setBusy] = useState(false);
  const go = () => { setBusy(true); void run(() => engine.request("gateway.restart.request", { reason: "settings" })).finally(() => setBusy(false)); };
  return <>
    <Needs engine={engine} need={["gateway.restart.request"]} where={row.label ?? ""}><Btn disabled={busy} onClick={go}>Restart the engine</Btn></Needs>
    <Failed text={failed} />
  </>;
}
