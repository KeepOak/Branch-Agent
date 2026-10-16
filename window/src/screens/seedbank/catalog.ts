// Seedbank's one list (preview item 28 / 31): every kind drawn from what the engine returns, never generated numbers.
// Agents are the eight day-one templates; Skills come from skills.search with installed state from skills.status;
// Connectors and Plugins from plugins.catalog.browse (split by catalog category); Themes & looks from themes.list.
// Grove layouts, Graft setups, Command-line tools, Toolsets and Adapters have no engine call yet, so they show Coming.
// A count shows only when the catalog returns it (Pitfall 14).
import { DAY_ONE_TEMPLATES, listedTemplate, readListedTemplates, type DayOneTemplate } from "./templates";

export type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? v as Rec : {});
const list = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export type KindId = "agents" | "groves" | "graftsets" | "skills" | "mcp" | "plugins" | "clis" | "toolsets" | "looks" | "adapters";
export type Kind = { id: KindId; label: string; one: string; coming?: string };

/** The kind chips, exactly the preview's (preview.html mkKinds: All · Agents · … · Adapters). A kind with `coming` has no
 *  engine call yet. Features that are not Seedbank items are Coming rows in their own screens, never a kind here (#1049). */
export const KINDS: readonly Kind[] = [
  { id: "agents", label: "Agents", one: "agent" },
  { id: "groves", label: "Grove layouts", one: "Grove layout", coming: "Grove layouts arrive in Seedbank in a later update." },
  { id: "graftsets", label: "Graft setups", one: "graft setup", coming: "Graft setups arrive in Seedbank in a later update." },
  { id: "skills", label: "Skills", one: "skill" },
  { id: "mcp", label: "Connectors", one: "connector" },
  { id: "plugins", label: "Plugins", one: "plugin" },
  { id: "clis", label: "Command-line tools", one: "command-line tool", coming: "Adding command-line tools from Seedbank comes in a later update." },
  { id: "toolsets", label: "Toolsets", one: "toolset", coming: "Toolsets arrive in Seedbank in a later update." },
  { id: "looks", label: "Themes & looks", one: "theme" },
  { id: "adapters", label: "Adapters", one: "adapter", coming: "Adapters arrive after release." },
];
export const kindOf = (id: KindId): Kind => KINDS.find(kind => kind.id === id)!;

/** Catalog categories that are services you connect to; every other category is a plugin. */
export const CONNECTOR_CATEGORIES: readonly string[] = ["web", "integrations", "documents-files", "inbox-collaboration", "productivity", "scheduling", "finance-payments", "sales-marketing", "data-analytics", "research"];

export type Source =
  | { type: "template"; template: DayOneTemplate; templateId: string | null; permissions: string[] }
  | { type: "skill"; ref: string }
  | { type: "plugin"; catalogId: string; pluginId: string; packageName: string; install: Rec | null; unavailable: boolean; /** On this computer (comes with Branch or installed). */ present?: boolean }
  | { type: "theme"; themeId: string };

export type Entry = {
  id: string; kind: KindId; name: string; by: string; desc: string;
  badge: "Official" | "Community"; checked: boolean;
  installed: boolean; inUse?: boolean;
  downloads?: number; updatedAt?: number; featuredRank?: number; category?: string;
  source: Source;
};

/** The day-one templates. Added when a Trunk of that name exists (agents.list). */
export function templateEntries(templateList: unknown, agents: unknown): Entry[] {
  const listed = readListedTemplates(templateList);
  const names = new Set(list(rec(agents).agents).map(a => (str(rec(a.identity).name) || str(a.name)).toLowerCase()).filter(Boolean));
  return DAY_ONE_TEMPLATES.map(template => {
    const found = listedTemplate(template, listed);
    return { id: "agents:" + template.id, kind: "agents", name: found?.name || template.name, by: "Branch", desc: found?.description || template.description, badge: "Official", checked: true,
      installed: names.has(template.name.toLowerCase()), source: { type: "template", template, templateId: found?.id ?? null, permissions: found?.permissions ?? [] } };
  });
}

/** Skill library results (skills.search), Added when skills.status already has the skill. */
export function skillEntries(search: unknown, status: unknown): Entry[] {
  const have = new Set(list(rec(status).skills).flatMap(s => [str(s.skillKey), str(s.name)]).filter(Boolean).map(s => s.toLowerCase()));
  const seen = new Set<string>();
  return list(rec(search).results).flatMap(r => {
    const slug = str(r.slug), ref = str(r.installRef) || slug;
    if (!ref || seen.has(ref)) return [];
    seen.add(ref);
    const official = r.official === true;
    return [{ id: "skills:" + ref, kind: "skills" as const, name: str(r.displayName) || slug, by: str(r.ownerHandle) || (official ? "Branch" : "someone"), desc: str(r.summary),
      badge: official ? "Official" as const : "Community" as const, checked: r.trustState === undefined, installed: have.has(slug.toLowerCase()), updatedAt: num(r.updatedAt), source: { type: "skill" as const, ref } }];
  });
}

/** The plugin catalog (plugins.catalog.browse), split into Connectors and Plugins by the item's first category. */
export function pluginEntries(browse: unknown): Entry[] {
  return list(rec(browse).items).flatMap(item => {
    const c = rec(item.catalog), local = rec(item.local), id = str(item.id);
    if (!id) return [];
    const categories = Array.isArray(c.categories) ? c.categories.filter((v): v is string => typeof v === "string") : [];
    const category = categories[0];
    const install = local.install ? rec(local.install) : str(c.packageName) ? { source: "clawhub", packageName: str(c.packageName) } : null;
    const official = c.official === true;
    const kind: KindId = category && CONNECTOR_CATEGORIES.includes(category) ? "mcp" : "plugins";
    return [{ id: kind + ":" + id, kind, name: str(c.name) || id, by: str(c.author) || (official ? "Branch" : "someone"), desc: str(c.summary), badge: official ? "Official" as const : "Community" as const,
      checked: Boolean(str(c.verificationTier)) || official, installed: local.installed === true, downloads: num(c.downloads), featuredRank: c.featured === true ? num(c.featuredRank) ?? 0 : undefined, category,
      source: { type: "plugin" as const, catalogId: id, pluginId: str(local.pluginId) || str(c.packageName) || id, packageName: str(c.packageName), install, unavailable: str(local.action) === "unavailable", present: local.present === true } }];
  });
}

/** Themes this engine already has (themes.list). There is no theme catalog yet, so every one is Added. */
export function themeEntries(themes: unknown): Entry[] {
  const current = str(rec(rec(themes).current).id);
  return list(rec(themes).themes).flatMap(t => {
    const id = str(t.id);
    if (!id) return [];
    const builtin = str(t.source) === "builtin";
    return [{ id: "looks:" + id, kind: "looks" as const, name: str(t.name) || id, by: builtin ? "Branch" : "You", desc: str(t.description), badge: builtin ? "Official" as const : "Community" as const, checked: builtin, installed: true, inUse: id === current, source: { type: "theme" as const, themeId: id } }];
  });
}

export type Sort = "popular" | "recent" | "stars" | "downloads";
export const SORTS: readonly { id: Sort; label: string; coming?: string; tip?: string }[] = [
  { id: "popular", label: "Most popular", tip: "Featured first, then the most added" },
  { id: "recent", label: "Most recent" },
  { id: "stars", label: "Most stars", coming: "Stars come with ratings in a later update." },
  { id: "downloads", label: "Most downloaded" },
];

const by = (value: (e: Entry) => number | undefined) => (a: Entry, b: Entry) => (value(b) ?? -1) - (value(a) ?? -1);
/** Stable sort on the numbers the engine returned; entries without the number keep their order at the end. */
export function sortEntries(entries: readonly Entry[], sort: Sort): Entry[] {
  const indexed = entries.map((entry, index) => ({ entry, index }));
  const compare = sort === "recent" ? by(e => e.updatedAt) : sort === "downloads" ? by(e => e.downloads)
    : (a: Entry, b: Entry) => (a.featuredRank ?? Infinity) - (b.featuredRank ?? Infinity) || by(e => e.downloads)(a, b);
  return indexed.sort((a, b) => compare(a.entry, b.entry) || a.index - b.index).map(item => item.entry);
}

/** Search by name or creator (and what it does). */
export function matches(entry: Entry, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || [entry.name, entry.by, entry.desc].some(text => text.toLowerCase().includes(q));
}

/** Featured: the top entry of each kind that has entries, up to four. */
export function featured(entries: readonly Entry[], sort: Sort): Entry[] {
  const out: Entry[] = [];
  for (const kind of KINDS) {
    const top = sortEntries(entries.filter(entry => entry.kind === kind.id), sort)[0];
    if (top) out.push(top);
    if (out.length === 4) break;
  }
  return out;
}

/** 1234 → 1.2k, 2400000 → 2.4M. */
export function shortCount(n: number): string {
  const one = (v: number) => v.toFixed(1).replace(/\.0$/, "");
  return n >= 1e6 ? one(n / 1e6) + "M" : n >= 1e3 ? one(n / 1e3) + "k" : String(n);
}
