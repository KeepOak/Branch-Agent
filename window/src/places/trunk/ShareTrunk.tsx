// "Share <Name>" on a Trunk's profile (preview 30-trunks shareDlg, kind trunk): three tabs. "With people" and
// "With the team" have no engine call yet, so they stay greyed with their reason. "As a file" saves the secret-free
// template that trunks.template.export returns; the other computer imports the file under Customize › Get capabilities.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Coming } from "../../glass/coming";
import { Dialog } from "../../shell/Dialog";
import { errorText, rec, str } from "./model";
import { Layer } from "./layer";

export type Shared = { template: unknown; link: string; warnings: string[]; routines: number; skills: number };

export function readShared(result: unknown): Shared {
  const r = rec(result), t = rec(r.template);
  return {
    template: r.template, link: str(r.link),
    warnings: Array.isArray(r.warnings) ? r.warnings.map(String) : [],
    routines: Array.isArray(t.automations) ? t.automations.length : 0,
    skills: Array.isArray(t.skills) ? t.skills.length : 0,
  };
}

/** "Night Shift" -> "night-shift.branch.trunk-template.json", the suffix the engine accepts on import. */
export function templateFileName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "trunk";
  return `${slug}.branch.trunk-template.json`;
}

const PEOPLE_WHY = "With people comes in a later update.";
const TEAM_WHY = "Share with the team comes in a later update.";
type Tab = "people" | "file" | "team";
const TABS: [Tab, string][] = [["people", "With people"], ["file", "As a file"], ["team", "With the team"]];

function FileTab({ name, shared, onSave }: { name: string; shared: Shared | null; onSave: () => void }) {
  return <>
    <p className="tk-hint">Saves who {name} is: its name, face, instructions, skills and what it may do. Never its conversations, memory, keys or reach.</p>
    {shared && shared.warnings.length > 0 && <ul className="tk-hint" data-testid="share-warnings">{shared.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
    <button type="button" className="btn pri" disabled={!shared} onClick={onSave}>Save as a file</button>
  </>;
}

export function ShareTrunkDialog({ engine, agentId, name, onClose }: { engine: WindowEngine; agentId: string; name: string; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("people");
  const [shared, setShared] = useState<Shared | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    engine.request("trunks.template.export", { agentId }).then((r) => { if (live) setShared(readShared(r)); }, (e: unknown) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [engine, agentId]);
  const save = () => {
    if (!shared) return;
    const href = URL.createObjectURL(new Blob([`${JSON.stringify(shared.template, null, 2)}\n`], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = href; link.download = templateFileName(name); link.click(); URL.revokeObjectURL(href);
  };
  const footer = <button type="button" className="btn pri" onClick={onClose}>Done</button>;
  return <Layer><Dialog title={`Share ${name}`} onClose={onClose} footer={footer} testid="share-trunk">
    <div className="tabs" role="tablist" style={{ margin: 0 }}>
      {TABS.map(([v, l]) => <button key={v} type="button" role="tab" className="tk-tab" aria-selected={tab === v} onClick={() => setTab(v)}>{l}</button>)}
    </div>
    {error && <p className="tk-error" role="alert">{error}</p>}
    {tab === "people" && <p className="tk-hint">{PEOPLE_WHY}</p>}
    {tab === "file" && <FileTab name={name} shared={shared} onSave={save} />}
    {tab === "team" && <>
      <p className="tk-hint">Your keepoak.com team can use {name} from their own Branch. Admins approve what it sends.</p>
      <p className="tk-hint">{TEAM_WHY}</p>
      <Coming need="trunks.template.share" unwired reason={TEAM_WHY}><button type="button" className="btn pri">Share with the team</button></Coming>
    </>}
  </Dialog></Layer>;
}
