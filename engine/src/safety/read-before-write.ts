// bytedance/deer-flow@f840e843d3e2db1485cb65ceae73a5525aa80193:backend/packages/harness/deerflow/agents/middlewares/read_before_write_middleware.py (atlas SAFETY-0170)
//
// Version gate: changing an existing file needs a read of its *current*
// version first. Marks hash the full file at read time; writes never refresh
// marks, so every modification needs a fresh read. Gate check and the write
// run under one per-(scope, path) lock so two parallel writes cannot pass on
// one stale mark. The gate fails open when it cannot inspect the file; the
// tool then reports its own error. It is one ordered check inside the
// existing before-tool-call path, not a separate decision engine.
import { createHash } from "node:crypto";
import path from "node:path";

export const READ_TOOLS: ReadonlySet<string> = new Set(["read"]);
export const GATED_WRITE_TOOLS: ReadonlySet<string> = new Set(["write", "edit"]);

const UNINSPECTABLE_CONTENT_PREFIX = "Error:";

/** Reads the file's current text. Throw an ENOENT error when it does not exist. */
export type CurrentFileReader = (filePath: string) => Promise<string>;

export type ReadBeforeWriteBlock = { path: string; tool: string; message: string };

export function normalizeMarkPath(filePath: string): string {
  return path.posix.normalize(filePath.replaceAll("\\", "/"));
}

export function contentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** Line count matching the read tool's numbering (a trailing newline ends the last line). */
export function countFileLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  const lines = content.split("\n").length;
  return content.endsWith("\n") ? lines - 1 : lines;
}

export function formatReadBeforeWriteBlock(
  toolName: string,
  filePath: string,
  content: string,
): string {
  const lineCount = countFileLines(content);
  const lineDesc = lineCount === 1 ? "1 line" : String(lineCount) + " lines";
  const readHint =
    lineCount === 0
      ? "Call read on it first, check what is already there, then retry."
      : "Call read on it first (e.g. offset=" +
        String(Math.max(1, lineCount - 29)) +
        ", limit=30), check what is already there, then retry.";
  return (
    "Error: " +
    toolName +
    " blocked — " +
    filePath +
    " already exists (" +
    lineDesc +
    ") and you have not read its current version. " +
    "Any write invalidates earlier reads, so re-read before every modification. " +
    readHint
  );
}

function isMissingFileError(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: unknown }).code === "ENOENT");
}

type Inspection =
  | { kind: "missing" }
  | { kind: "uninspectable" }
  | { kind: "content"; content: string };

async function inspect(reader: CurrentFileReader, filePath: string): Promise<Inspection> {
  try {
    const content = await reader(filePath);
    return content.startsWith(UNINSPECTABLE_CONTENT_PREFIX)
      ? { kind: "uninspectable" }
      : { kind: "content", content };
  } catch (err) {
    return isMissingFileError(err) ? { kind: "missing" } : { kind: "uninspectable" };
  }
}

/** Per-session read marks plus the per-path critical section. */
export class ReadBeforeWriteGate {
  private readonly marks = new Map<string, Map<string, string>>();
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly reader: CurrentFileReader) {}

  /** Runs fn while holding the (scope, path) lock. */
  async withPathLock<T>(scope: string, filePath: string, fn: () => Promise<T>): Promise<T> {
    const key = scope + "\u0000" + normalizeMarkPath(filePath);
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => current);
    this.locks.set(key, chained);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === chained) {
        this.locks.delete(key);
      }
    }
  }

  /** Stamps a mark after a successful read; error results and unreadable files get none. */
  async recordRead(
    scope: string,
    filePath: string,
    result: { isError: boolean },
  ): Promise<boolean> {
    if (result.isError) {
      return false;
    }
    const inspection = await inspect(this.reader, filePath);
    if (inspection.kind !== "content") {
      return false;
    }
    const scoped = this.marks.get(scope) ?? new Map<string, string>();
    scoped.set(normalizeMarkPath(filePath), contentHash(inspection.content));
    this.marks.set(scope, scoped);
    return true;
  }

  /** Drops marks whose read content left the context (compaction, summarization). */
  forgetReads(scope: string, filePaths?: readonly string[]): void {
    if (!filePaths) {
      this.marks.delete(scope);
      return;
    }
    const scoped = this.marks.get(scope);
    for (const filePath of filePaths) {
      scoped?.delete(normalizeMarkPath(filePath));
    }
  }

  /** Returns a block when an existing file changed since (or was never) read; null lets the write run. */
  async checkWrite(
    scope: string,
    filePath: string,
    toolName: string,
  ): Promise<ReadBeforeWriteBlock | null> {
    const inspection = await inspect(this.reader, filePath);
    if (inspection.kind !== "content") {
      return null;
    }
    const mark = this.marks.get(scope)?.get(normalizeMarkPath(filePath));
    if (mark === contentHash(inspection.content)) {
      return null;
    }
    return {
      path: normalizeMarkPath(filePath),
      tool: toolName,
      message: formatReadBeforeWriteBlock(toolName, filePath, inspection.content),
    };
  }

  /** Gate + write in one critical section; returns the block instead of running write when gated. */
  async guardWrite<T>(
    scope: string,
    filePath: string,
    toolName: string,
    write: () => Promise<T>,
  ): Promise<{ blocked: ReadBeforeWriteBlock } | { result: T }> {
    return this.withPathLock(scope, filePath, async () => {
      const blocked = GATED_WRITE_TOOLS.has(toolName)
        ? await this.checkWrite(scope, filePath, toolName)
        : null;
      return blocked ? { blocked } : { result: await write() };
    });
  }
}
