// Adapted from cline/cline@0809928ab28783c0d2b41c1e56edaf0951dadcab apps/vscode/src/core/context/context-tracking/FileContextTracker.ts, ContextTrackerTypes.ts.
// Branch has no chokidar watcher here: each tracked file's mtime/size is recorded and re-checked before the next prompt.
import fs from "node:fs/promises";

export type FileMetadataEntry = {
  path: string;
  record_state: "active" | "stale";
  record_source: "read_tool" | "user_edited" | "agent_edited" | "file_mentioned";
  agent_read_date: number | null;
  agent_edit_date: number | null;
  user_edit_date?: number | null;
};

export type FileContextOperation = FileMetadataEntry["record_source"];

type FileSnapshot = { mtimeMs: number; size: number };

export type FileContextTrackerOptions = {
  /** Resolves a tracked path to the file the agent tools actually touched. */
  resolvePath: (filePath: string) => string;
  statFile?: (absolutePath: string) => Promise<FileSnapshot | null>;
  now?: () => number;
};

async function statSnapshot(absolutePath: string): Promise<FileSnapshot | null> {
  try {
    const stat = await fs.stat(absolutePath);
    return stat.isFile() ? { mtimeMs: stat.mtimeMs, size: stat.size } : null;
  } catch {
    return null;
  }
}

/**
 * Tracks files the agent read or edited in one session. If a file changes outside the
 * agent afterwards, it is reported once so the agent re-reads it before editing.
 */
export class FileContextTracker {
  readonly sessionKey: string;
  readonly filesInContext: FileMetadataEntry[] = [];
  private readonly snapshots = new Map<string, FileSnapshot | null>();
  private readonly recentlyModifiedFiles = new Set<string>();
  private readonly resolvePath: (filePath: string) => string;
  private readonly statFile: (absolutePath: string) => Promise<FileSnapshot | null>;
  private readonly now: () => number;

  constructor(sessionKey: string, options: FileContextTrackerOptions) {
    this.sessionKey = sessionKey;
    this.resolvePath = options.resolvePath;
    this.statFile = options.statFile ?? statSnapshot;
    this.now = options.now ?? Date.now;
  }

  /** Records the file's current state; replaces Cline's per-file chokidar watcher. */
  async setupFileWatcher(filePath: string): Promise<void> {
    this.snapshots.set(filePath, await this.statFile(this.resolvePath(filePath)));
  }

  /**
   * Main entry point: called when a file is passed to the agent via a tool, mention, or edit.
   * Agent edits refresh the recorded state, which replaces Cline's markFileAsEditedByCline.
   */
  async trackFileContext(filePath: string, operation: FileContextOperation): Promise<void> {
    this.addFileToFileContextTracker(filePath, operation);
    await this.setupFileWatcher(filePath);
  }

  /** Marks older entries stale and appends the new active entry with the latest dates. */
  addFileToFileContextTracker(filePath: string, source: FileContextOperation): void {
    const now = this.now();
    for (const entry of this.filesInContext) {
      if (entry.path === filePath && entry.record_state === "active") {
        entry.record_state = "stale";
      }
    }
    const getLatestDateForField = (
      field: "agent_read_date" | "agent_edit_date" | "user_edit_date",
    ): number | null => {
      const dates = this.filesInContext
        .filter((entry) => entry.path === filePath && entry[field])
        .map((entry) => entry[field] as number)
        .toSorted((a, b) => b - a);
      return dates[0] ?? null;
    };
    const newEntry: FileMetadataEntry = {
      path: filePath,
      record_state: "active",
      record_source: source,
      agent_read_date: getLatestDateForField("agent_read_date"),
      agent_edit_date: getLatestDateForField("agent_edit_date"),
      user_edit_date: getLatestDateForField("user_edit_date"),
    };
    switch (source) {
      case "user_edited":
        newEntry.user_edit_date = now;
        this.recentlyModifiedFiles.add(filePath);
        break;
      case "agent_edited":
        newEntry.agent_read_date = now;
        newEntry.agent_edit_date = now;
        break;
      case "read_tool":
      case "file_mentioned":
        newEntry.agent_read_date = now;
        break;
    }
    this.filesInContext.push(newEntry);
  }

  /** Re-checks every tracked file; a changed file is a user edit (Cline's watcher "change" event). */
  async detectExternalChanges(): Promise<void> {
    for (const [filePath, previous] of [...this.snapshots]) {
      const current = await this.statFile(this.resolvePath(filePath));
      const changed =
        previous === null || current === null
          ? previous !== current
          : previous.mtimeMs !== current.mtimeMs || previous.size !== current.size;
      if (changed) {
        await this.trackFileContext(filePath, "user_edited");
      }
    }
  }

  /** Returns (and then clears) the set of recently modified files. */
  getAndClearRecentlyModifiedFiles(): string[] {
    const files = Array.from(this.recentlyModifiedFiles);
    this.recentlyModifiedFiles.clear();
    return files;
  }

  dispose(): void {
    this.snapshots.clear();
    this.recentlyModifiedFiles.clear();
  }
}

/** Cline's environment-details notice for files changed since the agent last accessed them. */
export function formatRecentlyModifiedFilesNotice(files: readonly string[]): string | undefined {
  if (files.length === 0) {
    return undefined;
  }
  return [
    "# Recently Modified Files",
    "These files have been modified since you last accessed them (file was just edited so you may need to re-read it before editing):",
    ...files,
  ].join("\n");
}
