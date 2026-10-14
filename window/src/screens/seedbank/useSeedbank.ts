// Seedbank's engine calls (HANDOFF R1-08): browse, installed state, who gets it, and the one install path per kind.
// A method this engine doesn't offer is never called; its controls show Coming instead.
import { useEffect, useMemo, useState } from "react";
import { availability, noteUnknownMethod, useCapabilityVersion } from "../../connect/capabilities";
import type { WindowEngine } from "../../connect/engine";
import { useResource } from "../../places/library/data";
import { pluginEntries, skillEntries, templateEntries, themeEntries, type Entry, type Rec } from "./catalog";
import { curatedEntries } from "./curated";
import { trunkDisplayName } from "../../connect/trunk-name";

const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? v as Rec : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The method when this engine may offer it (before the first hello nothing is known, so it is tried). */
export const offered = (engine: WindowEngine, method: string): string | null => (availability(engine, method) === "no" ? null : method);

function useSettled(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setSettled(value), ms); return () => clearTimeout(timer); }, [value, ms]);
  return settled;
}

export type Trunk = { id: string; name: string };
export function readTrunks(result: unknown): Trunk[] {
  const agents = rec(result).agents;
  return (Array.isArray(agents) ? agents.map(rec) : []).flatMap(a => (str(a.id) ? [{ id: str(a.id), name: trunkDisplayName(a) }] : []));
}

export function useSeedbank(engine: WindowEngine, query: string) {
  useCapabilityVersion();
  const q = useSettled(query.trim(), 250);
  const search = q ? { query: q } : {};
  const templates = useResource<unknown>(engine, offered(engine, "trunks.template.list"));
  const agents = useResource<unknown>(engine, offered(engine, "agents.list"));
  const browse = useResource<unknown>(engine, offered(engine, "plugins.catalog.browse"), { ...search, pageSize: 60 });
  const skills = useResource<unknown>(engine, offered(engine, "skills.search"), { ...search, limit: 30 });
  const status = useResource<unknown>(engine, offered(engine, "skills.status"));
  const themes = useResource<unknown>(engine, offered(engine, "themes.list"));
  useEffect(() => {
    for (const [method, error] of [["trunks.template.list", templates.error], ["plugins.catalog.browse", browse.error], ["skills.search", skills.error], ["themes.list", themes.error]] as const) {
      if (error) noteUnknownMethod(engine, method, new Error(error));
    }
  }, [engine, templates.error, browse.error, skills.error, themes.error]);
  // R1's Seedbank draws the preview's curated plugins and connectors only (curated.ts); the feed itself is unchanged.
  const entries = useMemo<Entry[]>(() => [
    ...templateEntries(templates.data, agents.data),
    ...skillEntries(skills.data, status.data),
    ...curatedEntries(pluginEntries(browse.data)),
    ...themeEntries(themes.data),
  ], [templates.data, agents.data, skills.data, status.data, browse.data, themes.data]);
  const remoteError = str(rec(browse.data).remoteError);
  const unknown = (error: string | null) => Boolean(error) && /unknown method/i.test(error ?? "");
  const offline = Boolean(remoteError) || (Boolean(browse.error) && !unknown(browse.error)) || (Boolean(skills.error) && !unknown(skills.error));
  const loading = browse.loading || skills.loading || templates.loading;
  const reload = () => { templates.reload(); agents.reload(); browse.reload(); skills.reload(); status.reload(); themes.reload(); };
  const trunks = useMemo(() => readTrunks(agents.data), [agents.data]);
  return { entries, trunks, offline, loading, reload, searched: q };
}

/** The call that adds an entry, or null with the reason it can't be added from here yet. */
export function addCall(entry: Entry): { method: string } | { reason: string } | null {
  const s = entry.source;
  if (entry.installed) return null;
  if (s.type === "template") return s.templateId ? { method: "trunks.template.create" } : { reason: entry.name + " arrives in a later update." };
  if (s.type === "skill") return { method: "skills.install" };
  if (s.type === "plugin") return s.unavailable ? { reason: "This one can’t be installed on this computer." } : s.install ? { method: "plugins.install" } : { reason: "The catalog gives no way to install it." };
  return null;
}

/** What the install sheet reads about an entry before it's added (skills.detail / plugins.catalog.get). */
export function detailCall(entry: Entry): { method: string; params: Rec } | null {
  const s = entry.source;
  if (s.type === "skill") return { method: "skills.detail", params: { slug: s.ref } };
  if (s.type === "plugin" && /^[A-Za-z0-9_-]+$/.test(s.catalogId)) return { method: "plugins.catalog.get", params: { id: s.catalogId } };
  return null;
}
