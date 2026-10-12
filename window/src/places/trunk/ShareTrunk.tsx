// "Share as template" on a Trunk's profile: trunks.template.export gives a secret-free template (persona with its job
// and anti-jobs, skills, routines, the channels it talks on) and a link that holds the same template. The owner saves
// the file or copies the link; the other computer imports either under Customize › Get capabilities › Trunk templates.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Dialog } from "../../shell/Dialog";
import { notify } from "../../shell/notify";
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

export function ShareTrunkDialog({ engine, agentId, name, onClose }: { engine: WindowEngine; agentId: string; name: string; onClose: () => void }) {
  const [shared, setShared] = useState<Shared | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    engine.request("trunks.template.export", { agentId }).then(r => { if (live) setShared(readShared(r)); }, (e: unknown) => { if (live) setError(errorText(e)); });
    return () => { live = false; };
  }, [engine, agentId]);
  const save = () => {
    if (!shared) return;
    const href = URL.createObjectURL(new Blob([`${JSON.stringify(shared.template, null, 2)}\n`], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = href; link.download = templateFileName(name); link.click(); URL.revokeObjectURL(href);
  };
  const copy = () => shared && navigator.clipboard?.writeText(shared.link).then(() => notify(`Copied the link for ${name}.`), (e: unknown) => notify(`Couldn’t copy: ${errorText(e)}`, { tone: "bad" }));
  const footer = <>
    <button type="button" className="btn ghost" onClick={onClose}>Close</button>
    <button type="button" className="btn ghost" disabled={!shared?.link} onClick={() => void copy()}>Copy link</button>
    <button type="button" className="btn pri" disabled={!shared} onClick={save}>Save template file</button>
  </>;
  return <Layer><Dialog title={`Share ${name} as a template`} onClose={onClose} footer={footer} testid="share-trunk">
    {!shared && !error && <p className="tk-hint" role="status">Making the template…</p>}
    {error && <p className="tk-error" role="alert">{error}</p>}
    {shared && <>
      <p className="tk-hint" role="status">The template holds {name}’s persona, {shared.skills === 1 ? "1 skill" : `${shared.skills} skills`} and {shared.routines === 1 ? "1 routine" : `${shared.routines} routines`}. It never holds secrets, memory, accounts or paths on this computer. On the other computer its routines arrive turned off until they are approved.</p>
      {shared.warnings.length > 0 && <ul className="tk-hint" data-testid="share-warnings">{shared.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
    </>}
  </Dialog></Layer>;
}
