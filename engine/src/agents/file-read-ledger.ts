/** Per-session record of how much of each file the agent has read. Guards whole-file writes only. */

type ReadCoverage = {
  /** Highest line read contiguously from line 1. */
  coveredLines: number;
  totalLines: number;
};

export type FileReadLedger = {
  /** Record a text read. Lines are 1-based and inclusive. */
  recordRead(params: {
    absolutePath: string;
    startLine: number;
    endLine: number;
    totalLines: number;
  }): void;
  /** Record a successful whole-file write: the agent now knows the full content. */
  recordWrite(params: { absolutePath: string; content: string }): void;
  /** Throws when a whole-file write would overwrite partially read content or shrink an unread file. */
  assertWholeFileWriteAllowed(params: {
    absolutePath: string;
    newBytes: number;
    existingBytes: number | null;
  }): void;
};

export const PARTIAL_READ_WRITE_REFUSAL =
  "You only read part of this file. Read the rest or use an edit instead.";
export const UNREAD_SHRINK_WRITE_REFUSAL =
  "You have not read this file, and this write would shrink it. Read it first, or use an edit.";

function ledgerKey(absolutePath: string): string {
  return process.platform === "win32" ? absolutePath.toLowerCase() : absolutePath;
}

/** Count lines the way the read tool does: a trailing newline does not start a new line. */
export function countTextLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const newlines = text.split("\n").length - 1;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

export function createFileReadLedger(): FileReadLedger {
  const coverage = new Map<string, ReadCoverage>();

  return {
    recordRead({ absolutePath, startLine, endLine, totalLines }) {
      const key = ledgerKey(absolutePath);
      const previous = coverage.get(key);
      const covered = previous?.coveredLines ?? 0;
      // A read only extends coverage when it starts at or before the next unread line.
      const extended = startLine <= covered + 1 ? Math.max(covered, endLine) : covered;
      coverage.set(key, {
        coveredLines: Math.min(extended, totalLines),
        totalLines,
      });
    },
    recordWrite({ absolutePath, content }) {
      const lines = countTextLines(content);
      coverage.set(ledgerKey(absolutePath), { coveredLines: lines, totalLines: lines });
    },
    assertWholeFileWriteAllowed({ absolutePath, newBytes, existingBytes }) {
      const entry = coverage.get(ledgerKey(absolutePath));
      if (entry) {
        if (entry.coveredLines < entry.totalLines) {
          throw new Error(PARTIAL_READ_WRITE_REFUSAL);
        }
        return;
      }
      if (existingBytes !== null && newBytes < existingBytes) {
        throw new Error(UNREAD_SHRINK_WRITE_REFUSAL);
      }
    },
  };
}
