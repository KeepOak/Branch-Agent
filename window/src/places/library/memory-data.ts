// What a Trunk remembers is its MEMORY.md (agents.files.*). Each top-level bullet is one memory; the indented
// lines under it belong to it. Forgetting removes that block and leaves every other byte as it was.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useCallback, useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { entriesOf, errorText, fileOf, trunkName, type Trunk } from "./data";
import type { FileEntry } from "./data";
import { mapLimited } from "./parts";

export type Fact = { agentId: string; trunk: string; text: string; detail: string; start: number; end: number };
export type MemoryFile = { agentId: string; trunk: string; file: FileEntry | null; error: string | null; facts: Fact[]; notes?: FileEntry[]; notesError?: string | null };

const BULLET = /^[-*+]\s+(.*\S)\s*$/;

/** Splits MEMORY.md into its bullets; start/end are line indexes, end exclusive. */
export function parseFacts(content: string, agentId: string, trunk: string): Fact[] {
  const lines = content.split("\n");
  const facts: Fact[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = BULLET.exec(lines[i]);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end]) && !BULLET.test(lines[end])) end++;
    const detail = lines.slice(i + 1, end).map(l => l.trim()).join(" ");
    facts.push({ agentId, trunk, text: m[1], detail, start: i, end });
    i = end - 1;
  }
  return facts;
}

/** MEMORY.md without one memory's lines. */
export function withoutFact(content: string, fact: Pick<Fact, "start" | "end">): string {
  const lines = content.split("\n");
  return [...lines.slice(0, fact.start), ...lines.slice(fact.end)].join("\n");
}

/** Every scoped Trunk's MEMORY.md, read together; one Trunk's failure stays on that Trunk. */
export function useMemoryFiles(engine: WindowEngine, trunks: Trunk[] | null) {
  const [files, setFiles] = useState<MemoryFile[] | null>(null);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision(n => n + 1), []);
  const ids = trunks?.map(t => t.id).join("\n") ?? null;
  useEffect(() => {
    if (!trunks) return;
    let current = true;
    void mapLimited(trunks, 4, async (t): Promise<MemoryFile> => {
      const trunk = trunkName(t);
      let notes: FileEntry[] = [];
      let notesError: string | null = null;
      try { notes = await listMemoryNotes(engine, t.id); }
      catch (error) { notesError = errorText(error); }
      const saved = { notes, notesError };
      try {
        const file = fileOf(await engine.request<unknown>("agents.files.get", { agentId: t.id, name: "MEMORY.md" }));
        if (!file) return { ...saved, agentId: t.id, trunk, file: null, error: "The engine did not return this Trunk’s MEMORY.md.", facts: [] };
        return { ...saved, agentId: t.id, trunk, file, error: null, facts: file.missing ? [] : parseFacts(file.content ?? "", t.id, trunk) };
      } catch (error) { return { ...saved, agentId: t.id, trunk, file: null, error: errorText(error), facts: [] }; }
    }).then(list => { if (current) setFiles(list); });
    return () => { current = false; };
  }, [engine, ids, revision]);
  return { files, reload };
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? v as Rec : {});
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : null);

/** The per-file start-of-conversation limit: the Trunk's own setting, the shared one, or the engine's stated default. */
export function configuredLimit(config: unknown, agentId: string | null): number | null {
  const agents = rec(rec(rec(config).config).agents);
  const own = agentId ? num(rec(rec(agents.entries)[agentId]).bootstrapMaxChars) : null;
  return own ?? num(rec(agents.defaults).bootstrapMaxChars);
}

/** The default the engine states in its own settings help ("… (default: 20000)"). */
export function statedDefault(lookup: unknown): number | null {
  const r = rec(lookup);
  const text = [rec(r.hint).help, rec(r.schema).description].find(v => typeof v === "string") as string | undefined;
  const m = text ? /default:\s*([\d,_]+)/i.exec(text) : null;
  return m ? num(Number(m[1].replace(/[,_]/g, ""))) : null;
}

/** Characters each Trunk's MEMORY.md puts at the start of a conversation, capped at the limit when known. */
export function loadedChars(files: MemoryFile[], limit: number | null): number {
  return files.reduce((max, f) => {
    const size = f.file && !f.file.missing ? (f.file.content ?? "").length : 0;
    return Math.max(max, limit ? Math.min(size, limit) : size);
  }, 0);
}

/** Saved Markdown notes, including named notes and nested folders, not just dated diaries.
 * Read metadata only; contents are fetched when a person opens a note. */
export async function listMemoryNotes(engine: WindowEngine, agentId: string): Promise<FileEntry[]> {
  const notes: FileEntry[] = [];
  const folders = ["memory"];
  const visited = new Set<string>();
  while (folders.length) {
    const path = folders.shift()!;
    if (visited.has(path)) continue;
    visited.add(path);
    let offset = 0;
    while (true) {
      let result: unknown;
      try { result = await engine.request<unknown>("agents.workspace.list", { agentId, path, offset, limit: 250 }); }
      catch (error) {
        if (path === "memory" && rec(rec(error).details).type === "workspace_path_not_found") break;
        throw error;
      }
      const entries = entriesOf(result);
      for (const entry of entries) {
        if (entry.kind === "directory") folders.push(entry.path);
        else if (/\.md$/i.test(entry.name)) notes.push(entry);
      }
      offset += entries.length;
      const total = rec(result).totalEntries;
      if (typeof total !== "number" || offset >= total) break;
      if (!entries.length) throw new Error("The engine returned an incomplete memory note list.");
    }
  }
  return notes.sort((a, b) => a.path.localeCompare(b.path));
}

/** Root prose remains readable even when it contains no bullet-shaped facts. */
export function savedNotes(file: MemoryFile): FileEntry[] {
  return [...(file.file && !file.file.missing && file.file.content?.trim() && !file.facts.length
    ? [{ ...file.file, path: "MEMORY.md" }] : []), ...(file.notes ?? [])];
}
