// Library › Activity › Made by Trunks, once the Made for you tab (preview 40-places made + 42-placesbp libDashHtmlPQ18 / libImgHtmlPQ18 + 94-g4p apps):
// Dashboards (sessions.list hasBoard + board.get), every Trunk's made files (artifacts.list per conversation),
// Images (artifacts.list type image, four at a time), Apps with Publish.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { Face } from "../../face/Face";
import { errorText, num, optStr, rec, recs, str, trunkName, useOperation, useResource, type Trunk } from "./data";
import { useMenu } from "./memory";
import { EmptyIcon, Grey, LibIcon, mapLimited, plural, Row, Section, TypeBadge, when } from "./parts";

export const APPS_REASON = "Needs the engine’s apps list with publish and roll back.";
const PAGE = 20;
const DASH_PAGE = 24;

export type SessionRow = { key: string; agentId?: string; label?: string; derivedTitle?: string; displayName?: string; updatedAt?: number | null; status?: string };
type Artifact = { id: string; title: string; type: string; mimeType?: string; sizeBytes?: number; sessionKey?: string; image?: { url: string }; download: { mode: "bytes" | "url" | "unsupported" } };
type Widget = { name: string; sizeW: number; sizeH: number; title?: string };

/** sessions.list rows that have a key; other fields read as missing. */
export function sessionsOf(result: unknown): SessionRow[] {
  return recs(rec(result).sessions).filter(r => typeof r.key === "string" && r.key).map(r => ({ key: r.key as string, agentId: optStr(r.agentId), label: optStr(r.label), derivedTitle: optStr(r.derivedTitle), displayName: optStr(r.displayName), updatedAt: num(r.updatedAt) ?? null, status: optStr(r.status) }));
}
/** artifacts.list entries with an id and a title; a missing download reads as not downloadable. */
export function artifactsOf(result: unknown): Artifact[] {
  return recs(rec(result).artifacts).filter(a => typeof a.id === "string" && typeof a.title === "string").map(a => {
    const mode = rec(a.download).mode, url = optStr(rec(a.image).url);
    return { id: a.id as string, title: a.title as string, type: str(a.type), mimeType: optStr(a.mimeType), sizeBytes: num(a.sizeBytes), ...(url ? { image: { url } } : {}), download: { mode: mode === "bytes" || mode === "url" ? mode : "unsupported" } };
  });
}
const pageOf = (result: unknown): SessionPage => { const r = rec(result); return { sessions: sessionsOf(r), totalCount: num(r.totalCount), hasMore: typeof r.hasMore === "boolean" ? r.hasMore : undefined, nextOffset: num(r.nextOffset) ?? null }; };

const agentOf = (row: SessionRow) => row.agentId ?? /^agent:([^:]+):/.exec(row.key)?.[1] ?? "";
export const sessionTitle = (row: SessionRow) => row.label || row.displayName || row.derivedTitle || row.key;

type Props = { engine: WindowEngine; trunks: Trunk[]; openConversation: (key: string) => void };

export function MadeTab(props: Props) {
  return <div className="lib-made">
    <Dashboards {...props} />
    <MadeFiles {...props} />
    <Section title="Apps" hint="Trunks make small apps as drafts; they’re published only when you ask. Publishing goes to this computer, or to your own cloud storage." testid="apps">
      <div className="lib-acts"><Grey label="Publish" reason={APPS_REASON} /><Grey ghost label="Roll back" reason={APPS_REASON} /></div>
    </Section>
  </div>;
}

type SessionPage = { sessions: SessionRow[]; totalCount?: number; hasMore?: boolean; nextOffset?: number | null };

/** Dashboards, a page at a time (sessions.list hasBoard), so every one can be reached. */
function useDashboards(engine: WindowEngine) {
  const [offset, setOffset] = useState(0);
  const rawPage = useResource<unknown>(engine, "sessions.list", { hasBoard: true, excludeSubagents: true, includeDerivedTitles: true, limit: DASH_PAGE, offset });
  const page = { ...rawPage, data: rawPage.data === null ? null : pageOf(rawPage.data) };
  const [earlier, setEarlier] = useState<SessionRow[]>([]);
  const all = [...earlier, ...(page.data?.sessions ?? [])];
  const more = () => { setEarlier(all); setOffset(page.data?.nextOffset ?? offset + DASH_PAGE); };
  return { page, all, total: page.data ? page.data.totalCount ?? all.length : null, hasMore: Boolean(page.data?.hasMore), more };
}

function Dashboards({ engine, trunks, openConversation }: Props) {
  const { page, all, total, hasMore, more } = useDashboards(engine);
  const [query, setQuery] = useState("");
  const [by, setBy] = useState("");
  const [sort, setSort] = useState<"recent" | "name">("recent");
  const menu = useMenu();
  const name = (id: string) => { const t = trunks.find(x => x.id === id); return t ? trunkName(t) : id; };
  const rows = all.filter(r => (!by || agentOf(r) === by) && (!query || `${sessionTitle(r)} ${name(agentOf(r))}`.toLowerCase().includes(query.toLowerCase())))
    .sort((a, b) => (sort === "name" ? sessionTitle(a).localeCompare(sessionTitle(b)) : (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
  return <Section title="Dashboards" side={total !== null ? <small>{plural(total, "dashboard", "dashboards")}</small> : undefined} testid="dashboards">
    <div className="lib-dtools">
      <label className="lib-field"><LibIcon name="search" /><input type="search" aria-label="Search dashboards" placeholder="Search dashboards…" value={query} onChange={e => setQuery(e.target.value)} /></label>
      <button type="button" className="btn sm" aria-haspopup="menu" onClick={e => menu.open(e, "Made by", [{ label: "All Trunks", run: () => setBy("") }, { kind: "sep" }, ...trunks.map(t => ({ label: trunkName(t), run: () => setBy(t.id) }))])}>Made by: {by ? name(by) : "All Trunks"}</button>
      <button type="button" className="btn sm" aria-haspopup="menu" onClick={e => menu.open(e, "Sort", [{ label: "Recently updated", run: () => setSort("recent") }, { label: "Name A–Z", run: () => setSort("name") }])}>Sort: {sort === "name" ? "Name A–Z" : "Recently updated"}</button>
    </div>
    {menu.element}
    {page.loading && <p className="lib-hint" role="status">Loading…</p>}
    {page.error && <p className="lib-bad" role="alert">{page.error}</p>}
    {total !== null && (!all.length ? <p className="lib-hint">No dashboards yet. Dashboards your Trunks build in a conversation show here.</p>
      : !rows.length ? <p className="lib-hint">No matching dashboards. Try another search or Trunk.</p>
      : <div className="lib-dgrid">{rows.map(r => <DashTile key={r.key} engine={engine} row={r} trunk={name(agentOf(r))} open={() => openConversation(r.key)} />)}</div>)}
    {hasMore && <button type="button" className="btn ghost sm lib-more" onClick={more}>Load more</button>}
  </Section>;
}

function DashTile({ engine, row, trunk, open }: { engine: WindowEngine; row: SessionRow; trunk: string; open: () => void }) {
  const rawBoard = useResource<unknown>(engine, "board.get", { sessionKey: row.key, ...(agentOf(row) ? { agentId: agentOf(row) } : {}) });
  const board = { error: rawBoard.error, data: rawBoard.data === null ? null : { widgets: recs(rec(rawBoard.data).widgets).map((w, i): Widget => ({ name: optStr(w.name) ?? String(i), sizeW: num(w.sizeW) ?? 4, sizeH: num(w.sizeH) ?? 4, title: optStr(w.title) })) } };
  const menu = useMenu();
  const title = sessionTitle(row);
  return <div className="lib-dtile">
    <button type="button" className="lib-dopen" aria-label={`Open ${title} on its dashboard`} onClick={open}>
      <span className="lib-dprev">{board.error ? <small>{board.error}</small> : (board.data?.widgets ?? []).slice(0, 6).map(w => <i key={w.name} title={w.title ?? w.name} style={{ gridColumn: `span ${Math.max(1, Math.min(3, Math.round(w.sizeW / 4)))}`, gridRow: `span ${w.sizeH > 4 ? 2 : 1}` }} />)}</span>
    </button>
    <div className="lib-dmeta"><b>{title}</b>{(row.status === "running" || row.status === "queued") && <span className="lib-pill work"><i />{row.status === "running" ? "Working" : "Queued"}</span>}
      <button type="button" className="ib" aria-label={`More for ${title}`} aria-haspopup="menu" onClick={e => menu.open(e, title, [{ label: "Open", run: open }])}><LibIcon name="more" /></button></div>
    {menu.element}
    <small className="lib-dby"><Face size={20} label={trunk} />By {trunk} · {row.updatedAt ? `Updated ${when(row.updatedAt)}` : "Update time unknown"}</small>
  </div>;
}

type Group = { row: SessionRow; trunk: string; files: Artifact[]; hasImages: boolean; error: string | null };

function useMadeFiles(engine: WindowEngine, trunks: Trunk[]) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(false);
  useEffect(() => {
    let current = true;
    const name = (id: string) => { const t = trunks.find(x => x.id === id); return t ? trunkName(t) : id; };
    void engine.request<unknown>("sessions.list", { excludeSubagents: true, limit: PAGE, offset }).then(pageOf).then(async page => {
      const found = await mapLimited(page.sessions ?? [], 4, async (row): Promise<Group> => {
        try {
          const r = { artifacts: artifactsOf(await engine.request<unknown>("artifacts.list", { sessionKey: row.key, ...(agentOf(row) ? { agentId: agentOf(row) } : {}), messageRole: "assistant" })) };
          return { row, trunk: name(agentOf(row)), files: r.artifacts.filter(a => a.type !== "image"), hasImages: r.artifacts.some(a => a.type === "image"), error: null };
        } catch (e) { return { row, trunk: name(agentOf(row)), files: [], hasImages: false, error: errorText(e) }; }
      });
      if (!current) return;
      setMore(page.hasMore ?? (page.sessions ?? []).length >= PAGE);
      setGroups(g => [...(offset && g ? g : []), ...found]);
    }, e => { if (current) setError(errorText(e)); });
    return () => { current = false; };
  }, [engine, trunks, offset]);
  return { groups, error, more, loadMore: () => setOffset(o => o + PAGE) };
}

function MadeFiles({ engine, trunks, openConversation }: Props) {
  const made = useMadeFiles(engine, trunks);
  const op = useOperation(engine);
  const files = made.groups?.flatMap(g => g.files.map(f => ({ f, g }))) ?? [];
  const withImages = made.groups?.filter(g => g.hasImages) ?? [];
  return <>
    {made.error && <p className="lib-bad" role="alert">{made.error}</p>}
    {!made.groups && !made.error && <p className="lib-hint" role="status">Loading…</p>}
    {made.groups?.filter(g => g.error).map(g => <p key={g.row.key} className="lib-bad" role="alert">{sessionTitle(g.row)}: {g.error}</p>)}
    {op.error && <p className="lib-bad" role="alert">{op.error}</p>}
    {made.groups && !files.length && !withImages.length && <EmptyLine icon={<EmptyIcon name="file" />}>Nothing made yet. Files your Trunks make show up here.</EmptyLine>}
    {!!files.length && <div className="lib-rows lib-made-files" data-testid="made-files">{files.map(({ f, g }) => <Row key={g.row.key + f.id} badge={<TypeBadge name={f.title} />} title={f.title} line={[g.trunk, kindWord(f), when(g.row.updatedAt)].filter(Boolean).join(" · ")}>
      <button type="button" className="btn sm" disabled={op.busy || f.download.mode === "unsupported"} title={f.download.mode === "unsupported" ? "The engine does not provide a download for this file." : undefined} onClick={() => openArtifact(op, g.row, f)}>Open</button>
    </Row>)}</div>}
    {!!withImages.length && <Section title="Images" testid="images">{withImages.map(g => <ImageGroup key={g.row.key} engine={engine} group={g} open={() => openConversation(g.row.key)} />)}</Section>}
    {made.more && <button type="button" className="btn ghost sm" onClick={made.loadMore}>Load more</button>}
  </>;
}

function kindWord(f: Artifact) {
  const m = f.mimeType ?? "";
  return /word/.test(m) ? "Word" : /sheet|excel/.test(m) ? "spreadsheet" : /presentation|powerpoint/.test(m) ? "slides" : /svg/.test(m) ? "chart" : "";
}

function openArtifact(op: ReturnType<typeof useOperation>, row: SessionRow, a: Artifact) {
  void op.run<{ artifact: Artifact; encoding?: "base64"; data?: string; url?: string }>("artifacts.download", { sessionKey: row.key, ...(agentOf(row) ? { agentId: agentOf(row) } : {}), artifactId: a.id }, result => {
    const link = document.createElement("a");
    if (typeof result.url === "string" && result.url) {
      const url = new URL(result.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The engine returned an unsupported file address.");
      link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; link.download = (result.artifact?.title || a.title); link.click();
      return;
    }
    if (!result.data || result.encoding !== "base64") throw new Error("The engine did not return the file’s bytes.");
    const href = URL.createObjectURL(new Blob([Uint8Array.from(atob(result.data), ch => ch.charCodeAt(0))], { type: (result.artifact?.mimeType || a.mimeType) || "application/octet-stream" }));
    link.href = href; link.download = (result.artifact?.title || a.title); link.click(); URL.revokeObjectURL(href);
  });
}

function ImageGroup({ engine, group, open }: { engine: WindowEngine; group: Group; open: () => void }) {
  const [pages, setPages] = useState<{ images: Artifact[]; cursor?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const cursor = pages.length ? pages[pages.length - 1].cursor : undefined;
  const params = (from?: string) => ({ sessionKey: group.row.key, ...(agentOf(group.row) ? { agentId: agentOf(group.row) } : {}), type: "image", limit: 4, ...(from ? { cursor: from } : {}) });
  const older = (from: string) => engine.request<unknown>("artifacts.list", params(from))
    .then(r => setPages(p => [...p, { images: artifactsOf(r), cursor: optStr(rec(r).nextCursor) }]), e => setError(errorText(e)));
  useEffect(() => {
    let current = true;
    void engine.request<unknown>("artifacts.list", params())
      .then(r => { if (current) setPages([{ images: artifactsOf(r), cursor: optStr(rec(r).nextCursor) }]); }, e => { if (current) setError(errorText(e)); });
    return () => { current = false; };
  }, [engine, group.row.key]); // the first four images, once per conversation
  const images = pages.flatMap(p => p.images).filter(a => a.type === "image");
  return <div className="lib-ig">
    <button type="button" className="link" onClick={open}>{sessionTitle(group.row)}</button>
    {error && <p className="lib-bad" role="alert">{error}</p>}
    <div className="lib-ithumbs">{images.map(img => img.image?.url ? <img key={img.id} className="lib-ithumb" src={img.image.url} alt={img.title} /> : <span key={img.id} className="lib-ibig" role="img" aria-label={img.title}>Too large to preview here.</span>)}</div>
    {cursor && <button type="button" className="btn ghost sm" onClick={() => void older(cursor)}>Older images</button>}
  </div>;
}
