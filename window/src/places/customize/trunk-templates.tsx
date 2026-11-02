// Customize › Tools › Get capabilities › Trunk templates: the catalog (the bundled templates and the ones imported on
// this computer, from trunks.template.list), Create from any of them, and Import from a template file or a pasted link.
// Import is one call to trunks.template.create, which also keeps the template in the catalog. The result says what the
// owner still has to approve: routines arrive turned off, and channels the template talks on may need setting up here.
// Prior art: Hermes Agent profile export/import and profile distributions (cron jobs installed paused, required
// connections shown as set or needing setup).
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { Dialog } from "../../shell/Dialog";
import { Icon } from "../../shell/icons";
import { useResource } from "../library/data";
import { plainError } from "../../shell/plain-error";
import { Status } from "../library/ui";
import { list, Pill, rec, str } from "./common";
import { Glyph } from "./glyphs";

export type TemplateRow = { id: string; source: "bundled" | "imported"; name: string; description: string; skills: number; routines: number; connections: string[] };
export type CreateOutcome = { name: string; agentId: string; routines: string[]; needs: string[]; ready: string[]; warnings: string[] };

const LINK_PREFIX = "branch-template:";

export function readTemplates(result: unknown): TemplateRow[] {
  return list(rec(result).templates).map((t): TemplateRow => ({
    id: str(t.id), source: t.source === "imported" ? "imported" : "bundled", name: str(t.name) || str(t.id), description: str(t.description),
    skills: Number(t.skills) || 0, routines: Number(t.routines) || 0,
    connections: Array.isArray(t.connections) ? t.connections.filter((c): c is string => typeof c === "string") : [],
  })).filter(t => t.id);
}

/** What trunks.template.create answered, in the words the result dialog shows. */
export function readOutcome(name: string, result: unknown): CreateOutcome {
  const r = rec(result);
  const connections = list(r.connections);
  return {
    name: str(r.name) || name, agentId: str(r.agentId),
    routines: list(r.routines).map(x => str(x.name)).filter(Boolean),
    needs: connections.filter(c => c.ready !== true).map(c => str(c.id)),
    ready: connections.filter(c => c.ready === true).map(c => str(c.id)),
    warnings: Array.isArray(r.warnings) ? r.warnings.map(String) : [],
  };
}

/** The create params for pasted text: a template link, or the template JSON itself. */
export function importParams(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  if (trimmed.startsWith(LINK_PREFIX)) return { link: trimmed };
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { throw new Error("Paste a template link (it starts with branch-template:) or the contents of a template file."); }
  return { template: parsed };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function detail(t: TemplateRow): string {
  const parts = [t.skills ? plural(t.skills, "skill") : "", t.routines ? plural(t.routines, "routine") : "", t.connections.length ? `talks on ${t.connections.join(", ")}` : ""].filter(Boolean);
  return parts.join(" · ");
}

export function TemplatesTab({ engine, done }: { engine: WindowEngine; done: () => void }) {
  const templates = useResource<unknown>(engine, "trunks.template.list");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CreateOutcome | null>(null);
  const [paste, setPaste] = useState("");
  const rows = readTemplates(templates.data);
  const create = async (key: string, name: string, params: Record<string, unknown>) => {
    setBusy(key); setError(null);
    try {
      const result = await engine.request("trunks.template.create", params);
      setOutcome(readOutcome(name, result)); setPaste(""); templates.reload(); done();
    } catch (e) { setError(plainError(e)); } finally { setBusy(null); }
  };
  const importText = (text: string, name: string) => {
    let params: Record<string, unknown>;
    try { params = importParams(text); } catch (e) { setError(plainError(e)); return; }
    const named = str(rec(params.template).name);
    void create("import", named || name, params);
  };
  const pickFile = (file: File | undefined) => { if (file) void file.text().then(text => importText(text, file.name), (e: unknown) => setError(plainError(e))); };

  return <>
    <div className="tpl-import" data-testid="template-import">
      <label className="cz-search"><Icon name="link" small /><input type="text" aria-label="Template link" placeholder="Paste a template link" value={paste} onChange={e => setPaste(e.target.value)} /></label>
      <button type="button" className="btn sm" disabled={!paste.trim() || busy !== null} onClick={() => importText(paste, "Imported Trunk")}>{busy === "import" ? "Importing" : "Import"}</button>
      <label className="btn ghost sm">Import a file<input type="file" accept=".json,application/json" hidden aria-label="Import a template file" onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; pickFile(f); }} /></label>
    </div>
    <p className="cz-hint">Templates carry a Trunk's persona, skills and routines. They never carry secrets, memory or accounts. Routines arrive turned off until you approve them.</p>
    <Status {...templates} />
    {error && <p role="alert" className="cz-error">{plainError(error)}</p>}
    {templates.data != null && !rows.length && <EmptyLine icon={<Glyph name="sparkle" size={22} />}>No templates yet.</EmptyLine>}
    <div className="get-rows">{rows.map(t => <div className="get-row" data-testid="template-row" data-source={t.source} key={t.id}>
      <span className="cz-tile"><Glyph name="sparkle" size={16} /></span>
      <span className="grow"><b>{t.name}</b><small>{t.description}</small>{detail(t) && <small className="get-perm">{detail(t)}</small>}</span>
      <Pill tone={t.source === "imported" ? "ok" : "idle"}>{t.source === "imported" ? "Imported" : "Bundled"}</Pill>
      <div className="cz-acts"><button type="button" className="btn sm" disabled={busy !== null} onClick={() => void create(t.id, t.name, { templateId: t.id })}>{busy === t.id ? "Creating" : "Create Trunk"}</button></div>
    </div>)}</div>
    {outcome && <TemplateResult outcome={outcome} close={() => setOutcome(null)} />}
  </>;
}

/** Says what was created and what the owner still has to approve or set up. */
export function TemplateResult({ outcome, close }: { outcome: CreateOutcome; close: () => void }) {
  return <Dialog title={`${outcome.name} is ready`} onClose={close} testid="template-result" footer={<button type="button" className="btn pri" onClick={close}>Done</button>}>
    <p className="dlg-p" role="status">Created the Trunk {outcome.name}.</p>
    {outcome.routines.length > 0 && <div data-testid="template-routines">
      <p className="dlg-p">{outcome.routines.length === 1 ? "Its routine is turned off" : `Its ${outcome.routines.length} routines are turned off`} until you approve {outcome.routines.length === 1 ? "it" : "them"}. Turn each on in Automations.</p>
      <ul>{outcome.routines.map(n => <li key={n}>{n} · <span className="get-perm">Off</span></li>)}</ul>
    </div>}
    {outcome.needs.length > 0 && <div data-testid="template-connections">
      <p className="dlg-p">It talks on {outcome.needs.join(", ")}, which {outcome.needs.length === 1 ? "is" : "are"} not set up on this computer yet. Connect {outcome.needs.length === 1 ? "it" : "them"} in Customize › Channels.</p>
    </div>}
    {outcome.ready.length > 0 && <p className="dlg-p">Already set up here: {outcome.ready.join(", ")}.</p>}
    {outcome.warnings.length > 0 && <ul className="cz-hint">{outcome.warnings.map(w => <li key={w}>{plainError(w)}</li>)}</ul>}
  </Dialog>;
}
