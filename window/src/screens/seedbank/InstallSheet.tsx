// The one install sheet (preview S.seedSheetP17, HANDOFF R1-08): live preview, kind · creator, What it adds, Safety check
// (Scan, Fingerprint, Hidden instructions, Secrets), What it may do, Who gets it, then [Cancel] [Add]. Add is off when
// hidden instructions were found. A failed add keeps the sheet open with the engine's words.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { WindowEngine } from "../../connect/engine";
import { Coming } from "../../glass/coming";
import { useLayer } from "../../glass/Popover";
import { Face } from "../../face/Face";
import { kindOf, type Entry, type Rec } from "./catalog";
import { ItemIcon, Soon } from "./parts";
import { fingerprint, hasHiddenInstructions, hasSecrets, parseSeed } from "./seed";
import { addCall, detailCall, type Trunk } from "./useSeedbank";

const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? v as Rec : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const errorText = (error: unknown) => (error instanceof Error ? error.message : str(rec(error).message) || String(error));

/** Floating glass sheet over a scrim. Esc and the scrim close it; focus returns to the opener. */
export function Sheet({ title, onClose, footer, children, wide }: { title: string; onClose: () => void; footer: ReactNode; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayer(true, onClose);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    (ref.current?.querySelector<HTMLElement>("textarea,input,button:not([aria-disabled='true'])") ?? ref.current)?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);
  return createPortal(<div className="sb-sheet-wrap">
    <button type="button" className="sb-scrim" aria-label="Close" data-local="" tabIndex={-1} onClick={onClose} />
    <div className="g-float sb-sheet" data-wide={wide || undefined} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
      <h2 className="sb-sheet-title">{title}</h2>
      <div className="sb-sheet-body">{children}</div>
      <div className="sb-sheet-foot">{footer}</div>
    </div>
  </div>, document.body);
}

type Safety = { scan: string; fp: string; hidden: boolean; secrets: string };
type Detail = { text: string; summary: string; tools: string[]; safety: Safety | null; error: string | null; loading: boolean };

const ADDS: Record<string, (e: Entry, tools: number) => string> = {
  agents: e => "A new Trunk, “" + e.name + "”, with its face and job",
  skills: e => "The skill “" + e.name + "” and its SKILL.md",
  mcp: (e, n) => "The connector “" + e.name + "”" + (n ? " with " + n + " tool" + (n === 1 ? "" : "s") : ""),
  plugins: e => "The plugin “" + e.name + "”",
  looks: e => "The theme “" + e.name + "”",
};

async function readSafety(entry: Entry, raw: unknown): Promise<Pick<Detail, "text" | "summary" | "tools" | "safety">> {
  const d = rec(raw);
  if (entry.source.type === "skill") {
    const card = rec(d.card), sec = rec(d.security), skill = rec(d.skill);
    const text = str(card.content);
    const scan = str(sec.status) === "available" ? str(sec.scanStatus) + (sec.hasWarnings === true ? " · with warnings" : "") : "Not scanned yet";
    return { text, summary: str(skill.description) || str(skill.summary) || entry.desc, tools: [],
      safety: { scan: scan || "Not scanned yet", fp: text ? await fingerprint(text) : "Not available", hidden: hasHiddenInstructions(text), secrets: hasSecrets(text) ? "Found: it carries something that looks like a key." : "None inside." } };
  }
  const security = rec(d.security), verification = rec(d.verification);
  const readme = str(d.readme);
  const keys = (Array.isArray(d.configFields) ? d.configFields.map(rec) : []).filter(f => f.sensitive === true).length;
  const tools = [...(Array.isArray(d.mcpServers) ? d.mcpServers.filter((t): t is string => typeof t === "string") : []), ...(Array.isArray(d.skills) ? d.skills.map(s => str(rec(s).name)).filter(Boolean) : [])];
  const scan = str(security.scanStatus) || str(verification.scanStatus) || str(d.verificationTier) || "Not scanned yet";
  const commit = str(verification.sourceCommit).slice(0, 8);
  return { text: readme, summary: entry.desc, tools,
    safety: { scan, fp: commit || (readme ? await fingerprint(readme) : "Not available"), hidden: hasHiddenInstructions(readme), secrets: hasSecrets(readme) ? "Found: it carries something that looks like a key." : keys ? "None inside. It asks for " + keys + " key" + (keys === 1 ? "" : "s") + "; Branch keeps them in the locker." : "None inside." } };
}

function useDetail(engine: WindowEngine, entry: Entry): Detail {
  const latest = useRef(entry);
  latest.current = entry;
  const [detail, setDetail] = useState<Detail>({ text: "", summary: entry.desc, tools: [], safety: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    const entry = latest.current, call = detailCall(entry);
    if (!call) { setDetail(d => ({ ...d, loading: false })); return; }
    engine.request(call.method, call.params).then(raw => readSafety(entry, raw)).then(
      read => { if (live) setDetail({ ...read, error: null, loading: false }); },
      error => { if (live) setDetail(d => ({ ...d, error: errorText(error), loading: false })); });
    return () => { live = false; };
  }, [engine, entry.id]);
  return detail;
}

export type AddResult = { notice: string };
type Props = { entry: Entry; engine: WindowEngine; trunks: Trunk[]; onClose: () => void; onDone: (result: AddResult) => void };

export function InstallSheet({ entry, engine, trunks, onClose, onDone }: Props) {
  const detail = useDetail(engine, entry);
  const [who, setWho] = useState<Set<string>>(() => new Set(trunks.map(t => t.id)));
  useEffect(() => { setWho(new Set(trunks.map(t => t.id))); }, [trunks]);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState<{ token: string; message: string } | null>(null);
  const kind = kindOf(entry.kind), s = entry.source;
  const template = s.type === "template";
  const safety: Safety = template ? { scan: "Made by Branch", fp: "Ships with Branch", hidden: false, secrets: "None inside." }
    : detail.safety ?? { scan: detail.loading ? "Checking…" : "Not scanned yet", fp: detail.loading ? "Checking…" : "Not available", hidden: false, secrets: detail.loading ? "Checking…" : "None found." };
  const call = addCall(entry);
  const where = { skills: "Skills", mcp: "Connectors", plugins: "Plugins" }[entry.kind as "skills"] ?? "Personal";

  async function add(token?: string) {
    if (!call || !("method" in call) || busy) return;
    setBusy(true); setError(null);
    try {
      if (s.type === "template") {
        const result = rec(await engine.request(call.method, { templateId: s.templateId }));
        const warnings = Array.isArray(result.warnings) ? result.warnings.filter((w): w is string => typeof w === "string") : [];
        onDone({ notice: entry.name + " is one of your Trunks now." + (warnings.length ? " " + warnings.join(" ") : "") });
      } else if (s.type === "skill") {
        const targets = trunks.length ? trunks.filter(t => who.has(t.id)).map(t => t.id) : [undefined];
        if (!targets.length) throw new Error("Pick at least one Trunk.");
        for (const agentId of targets) await engine.request(call.method, { ...(agentId ? { agentId } : {}), source: "clawhub", slug: s.ref });
        onDone({ notice: "Added " + entry.name + (trunks.length ? " for " + targets.length + " Trunk" + (targets.length === 1 ? "" : "s") : "") + ". It’s in Customize › " + where + "." });
      } else if (s.type === "plugin" && s.install) {
        const result = rec(await engine.request(call.method, { ...s.install, enable: true, ...(token ? { acknowledgeCapabilities: { reviewToken: token } } : {}) }));
        if (result.ok === false) throw new Error(str(result.error) || str(result.message) || "The engine did not add it.");
        onDone({ notice: "Added " + entry.name + ". It’s in Customize › " + where + "." });
      }
    } catch (e) {
      const details = rec(rec(e).details);
      if (str(details.capabilityConsentCode) && str(details.reviewToken)) setConsent({ token: str(details.reviewToken), message: errorText(e) });
      else setError(errorText(e));
    } finally { setBusy(false); }
  }

  async function remove() {
    if (s.type !== "plugin" || busy) return;
    setBusy(true); setError(null);
    try { await engine.request("plugins.uninstall", { pluginId: s.pluginId }); onDone({ notice: "Removed " + entry.name + "." }); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  const footer = <>
    <button type="button" className="sb-btn" data-local="" onClick={onClose}>{entry.installed ? "Close" : "Cancel"}</button>
    {entry.installed ? (s.type === "plugin" ? <Coming engine={engine} need="plugins.uninstall"><button type="button" className="sb-btn" data-danger="" disabled={busy} onClick={() => void remove()}>{busy ? "Removing…" : "Remove"}</button></Coming> : <span className="sb-added">{entry.inUse ? "In use" : "Added ✓"}</span>)
      : consent ? <button type="button" className="sb-btn" data-primary="" data-need="plugins.install" disabled={busy} onClick={() => void add(consent.token)}>Allow and add</button>
      : call && "method" in call ? <Coming engine={engine} need={call.method}><button type="button" className="sb-btn" data-primary="" disabled={busy || safety.hidden || detail.loading && !template} onClick={() => void add()}>{busy ? "Adding…" : "Add"}</button></Coming>
      : call ? <Soon className="sb-btn" need={s.type === "template" ? "trunks.template.create" : "plugins.install"} reason={call.reason} label={"Add " + entry.name}>Add</Soon> : null}
  </>;

  return <Sheet title={(entry.installed ? "" : "Add ") + entry.name + (entry.installed ? "" : "?")} onClose={onClose} footer={footer} wide>
    <div className="sb-preview">{template
      ? <div className="sb-look"><Face size={72} label={entry.name} pebbleLook={{ colour: s.template.colour }} /><b>{entry.name}</b><small>{entry.desc}</small></div>
      : detail.tools.length ? <p className="sb-tools">{detail.tools.map(t => <code key={t}>{t}</code>)}</p>
      : <div className="sb-look"><ItemIcon entry={entry} size={52} /><small>{detail.summary || entry.desc}</small></div>}</div>
    <div className="sb-meta"><span className="sb-pill">{kind.label}</span><span>by {entry.by}</span></div>
    <section className="sb-sec"><h3>What it adds</h3><p>{(ADDS[entry.kind] ?? (() => "Something new"))(entry, detail.tools.length)}</p></section>
    <section className="sb-sec"><h3>Safety check</h3><dl className="sb-kv">
      <dt>Scan</dt><dd>{safety.scan}</dd>
      <dt>Fingerprint</dt><dd><code>{safety.fp}</code></dd>
      <dt>Hidden instructions</dt><dd data-bad={safety.hidden || undefined}>{safety.hidden ? "Found: it tries to change a Trunk’s instructions. Don’t add it." : template ? "None: Branch wrote it." : detail.loading ? "Checking…" : detail.text ? "None found." : "Nothing to read yet."}</dd>
      <dt>Secrets</dt><dd>{safety.secrets}</dd>
    </dl>{detail.error && <p className="sb-note">The details didn’t load: {detail.error}</p>}</section>
    <section className="sb-sec"><h3>What it may do</h3>
      {template && s.permissions.length ? <ul className="sb-may">{s.permissions.map(p => <li key={p}>{p}</li>)}</ul>
        : detail.tools.length ? <div className="sb-may">{detail.tools.map(t => <div key={t} className="sb-may-row"><code>{t}</code><Soon className="sb-seg" need="tools.policy.set" reason="Choosing per tool comes in a later update." label={"What " + t + " may do"}>Allowed · Ask first · Never</Soon></div>)}</div>
        : <p className="sb-hint">{template ? "It asks before anything outside its job." : "Nothing beyond what the Trunk using it may already do."}</p>}
    </section>
    {s.type === "skill" && trunks.length > 0 && <section className="sb-sec"><h3>Who gets it</h3><div className="sb-who" data-local="">{trunks.map(t => <button key={t.id} type="button" className="sb-who-face" aria-pressed={who.has(t.id)} onClick={() => setWho(prev => { const next = new Set(prev); if (next.has(t.id)) next.delete(t.id); else next.add(t.id); return next; })}><Face size={26} label={t.name} /><span>{t.name}</span></button>)}</div></section>}
    {s.type === "plugin" && <section className="sb-sec"><h3>Who gets it</h3><p className="sb-hint">Every Trunk. Choosing Trunks for a plugin comes in a later update.</p></section>}
    {consent && <p className="sb-note" role="status">{consent.message}</p>}
    {error && <p className="sb-error" role="alert">{error}</p>}
  </Sheet>;
}

/** "＋ Paste a seed": a seed's text or a keepoak.com link. Links aren't local yet, so they say Coming. */
export function PasteSheet({ onClose, onSeed, initial = "" }: { onClose: () => void; onSeed: (text: string) => string | null; initial?: string }) {
  const [text, setText] = useState(initial), [error, setError] = useState<string | null>(null);
  const open = () => { const parsed = parseSeed(text); if (!parsed.ok) { setError(parsed.reason); return; } const failed = onSeed(text); if (failed) setError(failed); };
  return <Sheet title="Paste a seed" onClose={onClose} footer={<><button type="button" className="sb-btn" data-local="" onClick={onClose}>Cancel</button><button type="button" className="sb-btn" data-primary="" data-local="" onClick={open}>Open</button></>}>
    <p className="sb-hint">Paste a seed’s text. ⌘V anywhere on this page works too, and you can drop a .seed file on the window.</p>
    <textarea className="sb-input" rows={3} aria-label="Seed link or text" placeholder="Paste a seed" value={text} data-local="" onChange={e => { setText(e.target.value); setError(null); }} />
    {error && <p className="sb-error" role="alert">{error}</p>}
  </Sheet>;
}
