// Adapted from continuedev/continue core/edit/lazy/unifiedDiffApply.ts,
// pinned at 5522c6f44ca0ac3528b37244818fbfa39b5af470.
export type UnifiedDiffLine = { type: "same" | "new" | "old"; line: string };
type Hunk = { lines: string[]; start: number; oldCount: number };
export type UnifiedDiffFile = { oldPath: string; newPath: string; diff: string };

const HEADER = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,(\d+))? @@/;

export function isUnifiedDiffFormat(diff: string): boolean {
  const lines = diff.trim().split(/\r?\n/);
  const header = lines.findIndex((line) => HEADER.test(line));
  return header >= 0 && lines.slice(header + 1).some((line) => /^[+ -]/.test(line));
}

function parseHunks(diff: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | undefined;
  const lines = diff.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const header = line.match(HEADER);
    if (header) {
      current = { lines: [], start: Number(header[1]), oldCount: Number(header[2] ?? 1) };
      hunks.push(current);
    } else if (line.startsWith("@@")) {
      throw new Error("Invalid unified diff hunk header.");
    } else if (current && line !== "\\ No newline at end of file") {
      current.lines.push(line);
    }
  }
  if (!hunks.length || hunks.some((hunk) => !hunk.lines.length)) {
    throw new Error("Unified diff must contain a hunk with content.");
  }
  return hunks;
}

function linesMatch(source: readonly string[], before: readonly string[], start: number): boolean {
  return before.every(
    (line, index) => source[start + index]?.replace(/^\s+/, "") === line.replace(/^\s+/, ""),
  );
}

function findHunk(source: string[], hunk: Hunk, start: number): number {
  const before = hunk.lines.filter((line) => !line.startsWith("+")).map((line) => line.slice(1));
  const expected = hunk.oldCount === 0 ? hunk.start : Math.max(0, hunk.start - 1);
  if (
    expected >= start &&
    expected <= source.length - before.length &&
    linesMatch(source, before, expected)
  ) {
    return expected;
  }
  const matches: number[] = [];
  for (let index = start; index <= source.length - before.length; index++) {
    if (linesMatch(source, before, index)) matches.push(index);
  }
  if (matches.length > 1)
    throw new Error(
      "Unified diff hunk is ambiguous; include more context or correct line numbers.",
    );
  if (!matches.length) throw new Error("Hunk could not be applied cleanly to source code.");
  return matches[0]!;
}

function emitHunk(source: string[], hunk: Hunk, start: number, result: UnifiedDiffLine[]): number {
  let position = start;
  for (const line of hunk.lines) {
    if (line.startsWith("+")) result.push({ type: "new", line: line.slice(1) });
    else {
      result.push({ type: line.startsWith("-") ? "old" : "same", line: source[position]! });
      position++;
    }
  }
  return position;
}

function applyUnifiedDiffResult(
  sourceCode: string,
  diff: string,
): { lines: UnifiedDiffLine[]; touchesEnd: boolean } {
  const source = sourceCode.split(/\r?\n/);
  const result: UnifiedDiffLine[] = [];
  let position = 0;
  for (const hunk of parseHunks(diff)) {
    const start = findHunk(source, hunk, position);
    for (const line of source.slice(position, start)) result.push({ type: "same", line });
    position = emitHunk(source, hunk, start, result);
  }
  for (const line of source.slice(position)) result.push({ type: "same", line });
  return { lines: result, touchesEnd: position === source.length };
}

/** Continue's forward hunk matching retains the actual source context text. */
export function applyUnifiedDiff(sourceCode: string, diff: string): UnifiedDiffLine[] {
  return applyUnifiedDiffResult(sourceCode, diff).lines;
}

function decodeHeaderPath(header: string): string {
  const raw = header.slice(4).split("\t")[0]!.trim();
  const value: unknown = raw.startsWith('"') ? JSON.parse(raw) : raw;
  if (typeof value !== "string" || !value || /[\r\n\0]/.test(value)) {
    throw new Error("Invalid unified diff file path.");
  }
  return value.replace(/^[ab]\//, "");
}

function advanceHunk(position: { old: number; next: number }, line: string): void {
  const header = line.match(HEADER);
  if (header) {
    position.old = Number(header[2] ?? 1);
    position.next = Number(header[3] ?? 1);
  } else if (!line.startsWith("\\")) {
    if (!line.startsWith("+")) position.old--;
    if (!line.startsWith("-")) position.next--;
  }
}

/** File headers supply paths; headerless Continue diffs use the caller's path. */
export function parseUnifiedDiffFiles(input: string, filePath?: string): UnifiedDiffFile[] {
  const lines = input.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  const files: UnifiedDiffFile[] = [];
  const position = { old: 0, next: 0 };
  let current: UnifiedDiffFile | undefined;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const inHunk = position.old > 0 || position.next > 0;
    if (!inHunk && line.startsWith("diff --git ")) {
      current = undefined;
    } else if (!inHunk && line.startsWith("--- ") && lines[index + 1]?.startsWith("+++ ")) {
      current = {
        oldPath: decodeHeaderPath(line),
        newPath: decodeHeaderPath(lines[++index]!),
        diff: "",
      };
      files.push(current);
    } else if (HEADER.test(line) && !current) {
      if (!filePath) throw new Error("Provide path for a unified diff without file headers.");
      current = { oldPath: filePath, newPath: filePath, diff: "" };
      files.push(current);
      current.diff += `${line}\n`;
      advanceHunk(position, line);
    } else if (current && !line.startsWith("diff --git ") && !line.startsWith("index ")) {
      current.diff += `${line}\n`;
      advanceHunk(position, line);
    }
  }
  if (!files.length) throw new Error("Invalid unified diff: no file hunks.");
  for (const file of files) {
    if (!isUnifiedDiffFormat(file.diff))
      throw new Error("Unified diff must contain a hunk with content.");
  }
  return files;
}

export function applyUnifiedDiffText(source: string, diff: string): string {
  const bom = source.startsWith("\uFEFF") ? "\uFEFF" : "";
  if (bom) source = source.slice(1);
  const ending = source.includes("\r\n") ? "\r\n" : "\n";
  const applied = applyUnifiedDiffResult(source, diff);
  const result = applied.lines.filter((line) => line.type !== "old");
  let text = result.map((line) => line.line).join(ending);
  const lastLines = diff.trimEnd().split(/\r?\n/);
  if (lastLines.at(-1) === "\\ No newline at end of file" && !lastLines.at(-2)?.startsWith("-")) {
    if (text.endsWith(ending)) text = text.slice(0, -ending.length);
    return text ? bom + text : "";
  }
  if ((!source || applied.touchesEnd) && text && !text.endsWith(ending)) text += ending;
  return text ? bom + text : "";
}
