// Seedbank (R1-08, preview item 28): one component drawn in Customize › Community, inline in Settings › Seedbank, and
// opened by the sidebar Seedbank pill. Title, Paste a seed, kind chips, search, sort, Featured, then one section per
// kind. Uploads, ratings, star and copy counts, and keepoak.com links are Coming in R1.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import { Icon } from "../../shell/icons";
import { featured, KINDS, kindOf, matches, SEED_WHAT, SORTS, sortEntries, type Entry, type KindId, type Sort } from "./catalog";
import { InstallSheet, PasteSheet } from "./InstallSheet";
import { Adapters, Card, Row, Soon } from "./parts";
import { parseSeed, type Seed } from "./seed";
import { looksLikeTeam, parseTeamMarkdown, type TeamFile } from "./team-markdown";
import { TeamReview } from "./TeamReview";
import { useSeedbank } from "./useSeedbank";
import { CUSTOMIZE_REQUEST_EVENT, takeCustomizeRequest, type CustomizeMode, type CustomizeRequest } from "../../places/customize/r1-request";
import "../../glass/glass.css";
import "./seedbank.css";

export const KEEPOAK_COMING = "Coming: keepoak.com/seedbank";
const LEDE = "Agents, Grove layouts, graft setups, skills, connectors, plugins, command-line tools, toolsets, themes and looks, shared by people who use Branch.";

/** The entry a pasted seed names: one Seedbank already lists, or a new one built from its reference. */
export function entryForSeed(seed: Seed, entries: readonly Entry[]): Entry | null {
  const known = entries.find(e => (e.source.type === "template" && seed.kind === "agents" && e.source.template.id === seed.ref)
    || (e.source.type === "skill" && seed.kind === "skills" && e.source.ref === seed.ref)
    || (e.source.type === "plugin" && (seed.kind === "plugins" || seed.kind === "mcp") && e.source.packageName === seed.ref));
  if (known) return known;
  const base = { name: seed.name, by: seed.by || "someone", desc: "", badge: "Community" as const, checked: false, installed: false };
  if (seed.kind === "skills") return { ...base, id: "skills:" + seed.ref, kind: "skills", source: { type: "skill", ref: seed.ref } };
  if (seed.kind === "plugins" || seed.kind === "mcp") return { ...base, id: seed.kind + ":" + seed.ref, kind: seed.kind, source: { type: "plugin", catalogId: "", pluginId: seed.ref, packageName: seed.ref, install: { source: "clawhub", packageName: seed.ref }, unavailable: false } };
  return null;
}

type Props = { engine: WindowEngine; variant?: "place" | "settings"; /** The kind chip Seedbank opens on (Customize asks for one kind). */ initialKind?: KindId | "all" };

export function Seedbank({ engine, variant = "place", initialKind = "all" }: Props) {
  const [kind, setKind] = useState<KindId | "all">(initialKind);
  const [query, setQuery] = useState(""), [sort, setSort] = useState<Sort>("popular"), [cat, setCat] = useState("All");
  const [open, setOpen] = useState<Entry | null>(null), [paste, setPaste] = useState<string | null>(null);
  const [team, setTeam] = useState<TeamFile | null>(null);
  const [notice, setNotice] = useState<string | null>(null), [dropping, setDropping] = useState(false);
  const data = useSeedbank(engine, query);
  const shown = useMemo(() => sortEntries(data.entries.filter(e => (kind === "all" || e.kind === kind) && matches(e, query)), sort), [data.entries, kind, query, sort]);

  const openTeam = (text: string, seedReason: string): string | null => {
    if (!looksLikeTeam(text)) return seedReason;
    const parsed = parseTeamMarkdown(text);
    if (!parsed.ok) return parsed.reason;
    setPaste(null); setTeam(parsed.team); return null;
  };
  const openSeed = (text: string): string | null => {
    const parsed = parseSeed(text);
    if (!parsed.ok) return openTeam(text, parsed.reason);
    const entry = entryForSeed(parsed.seed, data.entries);
    if (!entry) return "That template isn’t in this version of Branch.";
    setPaste(null); setOpen(entry); return null;
  };
  // ⌘V on this page (outside a text field) and a dropped .seed or .md file open the sheet.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, [contenteditable='true']") || document.querySelector(".sb-sheet")) return;
      const text = event.clipboardData?.getData("text") ?? "";
      const parsed = parseSeed(text);
      if (!parsed.ok && !parsed.coming && !looksLikeTeam(text)) return;
      event.preventDefault();
      const failed = openSeed(text);
      if (failed) setNotice(failed);
    };
    const hasFile = (event: DragEvent) => [...(event.dataTransfer?.items ?? [])].some(item => item.kind === "file");
    const onOver = (event: DragEvent) => { if (hasFile(event)) { event.preventDefault(); setDropping(true); } };
    const onLeave = (event: DragEvent) => { if (!event.relatedTarget) setDropping(false); };
    const onDrop = (event: DragEvent) => {
      setDropping(false);
      const file = [...(event.dataTransfer?.files ?? [])].find(f => /\.(seed|md)$/i.test(f.name));
      if (!file) return;
      event.preventDefault();
      const kindWord = /\.md$/i.test(file.name) ? "a team" : "a seed";
      void file.text().then(text => { const failed = openSeed(text); if (failed) setNotice(failed === "That isn’t a seed link or file." ? `That file isn’t ${kindWord}.` : failed); });
    };
    document.addEventListener("paste", onPaste);
    window.addEventListener("dragover", onOver); window.addEventListener("dragleave", onLeave); window.addEventListener("drop", onDrop);
    return () => { document.removeEventListener("paste", onPaste); window.removeEventListener("dragover", onOver); window.removeEventListener("dragleave", onLeave); window.removeEventListener("drop", onDrop); };
  });

  const rowProps = { engine, onOpen: setOpen, onAdd: setOpen, onNotice: setNotice };
  const grid = (items: Entry[]) => <div className="sb-grid">{items.map(e => <Row key={e.id} entry={e} {...rowProps} />)}</div>;
  const section = (title: string, items: Entry[], more?: KindId) => <div className="sb-sec-list" key={title}>
    <div className="sb-sec-h"><b className="g-label">{title}</b><small className="g-label">{items.length}</small>{more && <button type="button" className="sb-all" data-local="" onClick={() => setKind(more)}>View all</button>}</div>
    {items.length ? grid(more ? items.slice(0, 4) : items) : <p className="sb-hint g-label">{data.loading ? "Loading…" : "Nothing here yet."}</p>}
  </div>;
  const comingSection = (id: KindId, brief: boolean) => {
    const k = kindOf(id);
    return <div className="sb-sec-list" key={id} data-coming-kind={id}>
      <div className="sb-sec-h"><b className="g-label">{k.label}</b><small className="g-label">Coming</small>{brief && id === "adapters" && <button type="button" className="sb-all" data-local="" onClick={() => setKind(id)}>View all</button>}</div>
      {id === "adapters" ? <Adapters brief={brief} /> : <p className="sb-hint g-label" data-lines>{k.what ? k.what + " " : ""}{k.coming}</p>}
    </div>;
  };

  function results() {
    if (query.trim()) return shown.length ? section(shown.length + " result" + (shown.length === 1 ? "" : "s"), shown) : <p className="sb-none g-label">Nothing matches. Try another word.</p>;
    if (kind !== "all") {
      const k = kindOf(kind);
      if (k.coming) return comingSection(kind, false);
      if (kind === "mcp") {
        const cats = ["All", ...new Set(shown.map(e => e.category).filter((c): c is string => Boolean(c)))];
        const list = shown.filter(e => cat === "All" || e.category === cat);
        return <>
          <div className="sb-acts">
            <Soon className="sb-btn" need="mcp.import" reason="Bringing connectors in from other apps comes in a later update.">Bring in from other apps</Soon>
            <Soon className="sb-btn" need="mcp.registry.search" reason="Searching the public registry comes in a later update.">Public registry</Soon>
            <Soon className="sb-btn" need="mcp.servers.add" reason="Adding your own server from Seedbank comes in a later update. Customize › Connectors has it.">Your own server</Soon>
          </div>
          {cats.length > 1 && <div className="sb-cats" role="group" aria-label="Categories" data-local="">{cats.map(c => <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}>{c === "All" ? c : c.replace(/-/g, " ").replace(/^./, m => m.toUpperCase())}</button>)}</div>}
          {section("Connectors", list)}
        </>;
      }
      if (kind === "skills") return <>
        <div className="sb-acts">
          <Soon className="sb-btn" need="skills.import" reason="Bringing a skill in from Seedbank comes in a later update. Customize › Skills has it.">Bring one in</Soon>
          <Soon className="sb-btn" need="skills.workshop.create" reason="Writing a skill with Branch from Seedbank comes in a later update.">Write one with Branch</Soon>
        </div>
        {section("Skills", shown)}
      </>;
      if (kind === "plugins") return <>{section("Official", shown.filter(e => e.badge === "Official"))}{section("Community", shown.filter(e => e.badge === "Community"))}</>;
      return section(k.label, shown);
    }
    const top = featured(shown, sort);
    return <>
      {top.length > 0 && <div className="sb-featured" aria-label="Featured">{top.map(e => <Card key={e.id} entry={e} {...rowProps} />)}</div>}
      {KINDS.map(k => (k.coming ? comingSection(k.id, true) : section(k.label, shown.filter(e => e.kind === k.id), k.id)))}
    </>;
  }

  return <div className="sb g-clear" data-variant={variant} data-dropping={dropping || undefined}>
    <div className="sb-top">
      <div>{variant === "place" && <h2 className="sb-title g-label">Seedbank</h2>}<p className="sb-hint g-label" data-lines>{LEDE}</p></div>
      <Soon className="sb-web" need="seedbank.web" reason={KEEPOAK_COMING} label="Open on keepoak.com (coming)">Open on keepoak.com ↗</Soon>
    </div>
    <div className="sb-paste"><button type="button" className="sb-btn" data-local="" onClick={() => setPaste("")}>＋ Paste a seed</button><small className="g-label" data-lines>{SEED_WHAT} Paste one here, press ⌘V on this page, or drop a .seed file on the window.</small></div>
    <div className="sb-chips" role="tablist" aria-label="Kinds" data-local="">
      {[{ id: "all" as const, label: "All" }, ...KINDS].map(k => <button key={k.id} type="button" role="tab" className="sb-chip" aria-selected={kind === k.id} title={"what" in k ? k.what : undefined} onClick={() => { setKind(k.id); setCat("All"); }}>{k.label}</button>)}
    </div>
    <label className="sb-search g-frost"><Icon name="search" size={16} /><input type="search" placeholder="Search by name or creator" aria-label="Search Seedbank by name or creator" autoComplete="off" data-local="" value={query} onChange={e => setQuery(e.target.value)} /></label>
    <div className="sb-sort" role="group" aria-label="Sort">
      {SORTS.map(s => s.coming ? <Soon key={s.id} need="seedbank.ratings" reason={s.coming}>{s.label}</Soon>
        : <button key={s.id} type="button" data-local="" aria-pressed={sort === s.id} title={s.tip} onClick={() => setSort(s.id)}>{s.label}</button>)}
    </div>
    {data.offline && <p className="sb-notice g-label" data-lines role="status">Seedbank is offline · <button type="button" data-local="" onClick={data.reload}>Try again</button></p>}
    {notice && <p className="sb-notice g-label" data-lines role="status">{notice} <button type="button" className="sb-x" data-local="" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button></p>}
    <div className="sb-results">{results()}</div>
    {open && <InstallSheet entry={open} engine={engine} trunks={data.trunks} onClose={() => setOpen(null)} onDone={result => { setOpen(null); setNotice(result.notice); data.reload(); }} />}
    {team && <TeamReview team={team} engine={engine} onClose={() => setTeam(null)} onDone={result => { setTeam(null); setNotice(result.notice); data.reload(); }} />}
    {paste !== null && <PasteSheet initial={paste} onClose={() => setPaste(null)} onSeed={openSeed} />}
  </div>;
}

/** Customize with its Personal | Community switch. `initial` is the mode the mount was asked for; later requests (requestCustomize) switch it. */
export function CustomizeWithCommunity({ engine, personal, initial = "personal", initialKind }: { engine: WindowEngine; personal: ReactNode; initial?: CustomizeMode; initialKind?: string }) {
  const [mode, setMode] = useState<CustomizeMode>(initial);
  const [community, setCommunity] = useState<{ kind: string; n: number } | undefined>(initialKind ? { kind: initialKind, n: 0 } : undefined);
  useEffect(() => {
    const onRequest = (event: Event) => {
      takeCustomizeRequest();
      const request = (event as CustomEvent<CustomizeRequest>).detail;
      if (request?.mode) setMode(request.mode);
      if (request?.community) setCommunity({ kind: request.community, n: Date.now() });
    };
    addEventListener(CUSTOMIZE_REQUEST_EVENT, onRequest);
    return () => removeEventListener(CUSTOMIZE_REQUEST_EVENT, onRequest);
  }, []);
  return <CustomizeModes engine={engine} mode={mode} onMode={setMode} personal={personal} community={community} />;
}

/** Customize's switch (item 28): Personal is today's Customize, Community is Seedbank. */
export function CustomizeModes({ engine, mode, onMode, personal, community }: { engine: WindowEngine; mode: CustomizeMode; onMode: (mode: CustomizeMode) => void; personal: ReactNode; community?: { kind: string; n: number } }) {
  return <div className="sb-place">
    <div className="sb-modes"><span className="g-frost sb-modes-seg" role="tablist" aria-label="Customize" data-local="">
      {(["personal", "community"] as const).map(m => <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => onMode(m)}>{m === "personal" ? "Personal" : "Community"}</button>)}
    </span></div>
    {mode === "community" ? <><h1 className="sb-sr">Customize · Community</h1><Seedbank key={community?.n ?? 0} engine={engine} initialKind={(community?.kind ?? "all") as KindId | "all"} /></> : personal}
  </div>;
}
