// Unified patch text (sessions.diff files[].patch) read into hunks of lines for the Changes view.
export type DiffLine = { kind: "add" | "del" | "ctx"; text: string; oldNo?: number; newNo?: number };
export type Hunk = { header: string; lines: DiffLine[]; oldStart: number; newStart: number };

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

export function parsePatch(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let cur: Hunk | null = null;
  let oldNo = 0,
    newNo = 0;
  for (const raw of patch.replace(/\r\n/g, "\n").split("\n")) {
    const m = HUNK.exec(raw);
    if (m) {
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      cur = { header: (m[3] ?? "").trim(), lines: [], oldStart: oldNo, newStart: newNo };
      hunks.push(cur);
      continue;
    }
    if (!cur || raw.startsWith("\\")) continue; // file headers before the first hunk; "\ No newline at end of file"
    if (raw.startsWith("+")) cur.lines.push({ kind: "add", text: raw.slice(1), newNo: newNo++ });
    else if (raw.startsWith("-")) cur.lines.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++ });
    else if (raw.startsWith(" ") || raw === "") cur.lines.push({ kind: "ctx", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
  }
  // A trailing empty context line comes from the final newline, not the file.
  for (const h of hunks) if (h.lines.at(-1)?.kind === "ctx" && h.lines.at(-1)?.text === "") h.lines.pop();
  return hunks;
}

/** Lines unchanged between two hunks (shown as "N unchanged lines"). */
export function gapBetween(a: Hunk, b: Hunk): number {
  const lastOld = [...a.lines].reverse().find((l) => l.oldNo !== undefined)?.oldNo ?? a.oldStart - 1;
  return Math.max(0, b.oldStart - lastOld - 1);
}

/** Split view rows: deletions on the left beside the additions that replaced them. */
export function splitRows(h: Hunk): { left?: DiffLine; right?: DiffLine }[] {
  const rows: { left?: DiffLine; right?: DiffLine }[] = [];
  let dels: DiffLine[] = [],
    adds: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) rows.push({ left: dels[i], right: adds[i] });
    dels = [];
    adds = [];
  };
  for (const l of h.lines) {
    if (l.kind === "del") dels.push(l);
    else if (l.kind === "add") adds.push(l);
    else {
      flush();
      rows.push({ left: l, right: l });
    }
  }
  flush();
  return rows;
}
