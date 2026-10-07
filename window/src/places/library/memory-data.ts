// What a Trunk remembers is its MEMORY.md (agents.files.*). Each top-level bullet is one memory; the indented
// lines under it belong to it. Forgetting removes that block and leaves every other byte as it was.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useCallback, useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { entriesOf, errorText, fileOf, trunkName, type Trunk } from "./data";
import type { FileEntry } from "./data";
import { mapLimited } from "./parts";

export type Fact = { agentId: string; trunk: string; text: string; detail: string; start: number; end: number };
export type MemoryFile = { agentId: string; trunk: string; file: FileEntry | null; error: string | null; facts: Fact[] };

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

/** True when a search hit names the Trunk's MEMORY.md (not a daily note or session file). */
export function isMemoryMd(path: string): boolean {
  return /(^|[\\/])MEMORY\.md$/i.test(path);
}

/** The MEMORY.md fact a search hit refers to, or null when it cannot be placed. */
export function factForHit(facts: Fact[], hit: { path: string; snippet: string; startLine?: number }): Fact | null {
  const snippet = hit.snippet.trim().replace(/^[-*+#>\s]+/, "");
  if (isMemoryMd(hit.path) && typeof hit.startLine === "number") {
    for (const idx of [hit.startLine - 1, hit.startLine]) {
      const found = facts.find((f) => idx >= f.start && idx < f.end);
      if (found) return found;
    }
  }
  if (!snippet) return null;
  const matches = facts.filter((f) => f.text.includes(snippet) || snippet.includes(f.text));
  if (matches.length === 1) return matches[0]!;
  return isMemoryMd(hit.path) ? matches[0] ?? null : null;
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
      try {
        const file = fileOf(await engine.request<unknown>("agents.files.get", { agentId: t.id, name: "MEMORY.md" }));
        if (!file) return { agentId: t.id, trunk, file: null, error: "The engine did not return this Trunk’s MEMORY.md.", facts: [] };
        return { agentId: t.id, trunk, file, error: null, facts: file.missing ? [] : parseFacts(file.content ?? "", t.id, trunk) };
      } catch (error) { return { agentId: t.id, trunk, file: null, error: errorText(error), facts: [] }; }
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

/** Daily notes (memory/YYYY-MM-DD*.md) across the scoped Trunks; null until every folder answered. */
export function useDailyNotes(engine: WindowEngine, agentIds: string[]) {
  const [count, setCount] = useState<number | null>(null);
  const key = agentIds.join("\n");
  useEffect(() => {
    let current = true;
    setCount(null);
    void Promise.all(key.split("\n").filter(Boolean).map(agentId => engine.request<unknown>("agents.workspace.list", { agentId, path: "memory" })
      .then(r => entriesOf(r).filter(e => e.kind !== "directory" && /^\d{4}-\d{2}-\d{2}.*\.md$/.test(e.name)).length)))
      .then(counts => { if (current) setCount(counts.reduce((a, b) => a + b, 0)); }, () => { if (current) setCount(null); });
    return () => { current = false; };
  }, [engine, key]);
  return count;
}
