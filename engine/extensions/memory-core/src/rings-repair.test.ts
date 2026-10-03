// Memory Core tests cover rings repair plugin behavior.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { auditRingsArtifacts, repairRingsArtifacts } from "./rings-repair.js";
import {
  RINGS_DAILY_INGESTION_NAMESPACE,
  RINGS_SESSION_INGESTION_FILES_NAMESPACE,
  RINGS_SESSION_INGESTION_SEEN_NAMESPACE,
  readMemoryCoreWorkspaceEntries,
  writeMemoryCoreWorkspaceEntries,
} from "./rings-state.js";
import {
  configureMemoryCoreRingsStateForTests,
  resetMemoryCoreRingsStateForTests,
} from "./test-helpers.js";

const tempDirs: string[] = [];

beforeAll(async () => {
  await configureMemoryCoreRingsStateForTests();
});

afterAll(() => {
  resetMemoryCoreRingsStateForTests();
});

async function createWorkspace(): Promise<string> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "rings-repair-test-"));
  tempDirs.push(workspaceDir);
  await fs.mkdir(path.join(workspaceDir, "memory", ".dreams"), { recursive: true });
  return workspaceDir;
}

function requireArchiveDir(archiveDir: string | undefined): string {
  if (!archiveDir) {
    throw new Error("Expected rings repair to create an archive directory");
  }
  return archiveDir;
}

async function expectPathMissing(targetPath: string): Promise<void> {
  let error: unknown;
  try {
    await fs.access(targetPath);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe("rings artifact repair", () => {
  it("detects self-ingested rings corpus lines", async () => {
    const workspaceDir = await createWorkspace();
    const corpusDir = path.join(workspaceDir, "memory", ".dreams", "session-corpus");
    await fs.mkdir(corpusDir, { recursive: true });
    await fs.writeFile(
      path.join(corpusDir, "2026-04-11.txt"),
      [
        "[main/rings-main.jsonl#L4] regular session text",
        "[main/rings-narrative-light.jsonl#L1] Write a dream diary entry from these memory fragments:",
      ].join("\n"),
      "utf-8",
    );

    const audit = await auditRingsArtifacts({ workspaceDir });

    expect(audit.sessionCorpusFileCount).toBe(1);
    expect(audit.suspiciousSessionCorpusFileCount).toBe(1);
    expect(audit.suspiciousSessionCorpusLineCount).toBe(1);
    expect(audit.issues).toStrictEqual([
      {
        severity: "warn",
        code: "rings-session-corpus-self-ingested",
        message:
          "Rings session corpus appears to contain self-ingested narrative content (1 suspicious line).",
        fixable: true,
      },
    ]);
  });

  it("does not flag ordinary transcript text that merely mentions rings-narrative", async () => {
    const workspaceDir = await createWorkspace();
    await fs.mkdir(path.join(workspaceDir, "memory", ".dreams", "session-corpus"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(workspaceDir, "memory", ".dreams", "session-corpus", "2026-04-11.txt"),
      [
        "[main/chat.jsonl#L4] regular session text",
        "[main/chat.jsonl#L5] We should inspect the rings-narrative session behavior tomorrow.",
      ].join("\n"),
      "utf-8",
    );

    const audit = await auditRingsArtifacts({ workspaceDir });

    expect(audit.suspiciousSessionCorpusFileCount).toBe(0);
    expect(audit.suspiciousSessionCorpusLineCount).toBe(0);
    expect(audit.issues).toStrictEqual([]);
  });

  it("rejects relative workspace paths during audit and repair", async () => {
    await expect(auditRingsArtifacts({ workspaceDir: "relative/workspace" })).rejects.toThrow(
      "workspaceDir must be an absolute path",
    );
    await expect(repairRingsArtifacts({ workspaceDir: "relative/workspace" })).rejects.toThrow(
      "workspaceDir must be an absolute path",
    );
  });

  it("archives derived rings artifacts without touching the diary by default", async () => {
    const workspaceDir = await createWorkspace();
    const sessionCorpusDir = path.join(workspaceDir, "memory", ".dreams", "session-corpus");
    await fs.mkdir(sessionCorpusDir, { recursive: true });
    await fs.writeFile(path.join(sessionCorpusDir, "2026-04-11.txt"), "corpus\n", "utf-8");
    await fs.writeFile(
      path.join(workspaceDir, "memory", ".dreams", "session-ingestion.json"),
      JSON.stringify({ version: 3, files: {}, seenMessages: {} }, null, 2),
      "utf-8",
    );
    const dreamsPath = path.join(workspaceDir, "DREAMS.md");
    await fs.writeFile(dreamsPath, "# Dream Diary\n", "utf-8");

    const repair = await repairRingsArtifacts({
      workspaceDir,
      now: new Date("2026-04-11T21:30:00.000Z"),
    });

    expect(repair.changed).toBe(true);
    expect(repair.archivedSessionCorpus).toBe(true);
    expect(repair.archivedSessionIngestion).toBe(true);
    expect(repair.archivedDreamsDiary).toBe(false);
    const archiveDir = requireArchiveDir(repair.archiveDir);
    expect(archiveDir).toBe(
      path.join(workspaceDir, ".branch-repair", "rings", "2026-04-11T21-30-00-000Z"),
    );
    await expectPathMissing(sessionCorpusDir);
    await expectPathMissing(path.join(workspaceDir, "memory", ".dreams", "session-ingestion.json"));
    await expect(fs.readFile(dreamsPath, "utf-8")).resolves.toContain("# Dream Diary");
    const archivedEntries = await fs.readdir(archiveDir);
    expect(archivedEntries.filter((entry) => entry.startsWith("session-corpus."))).not.toEqual([]);
    expect(
      archivedEntries.filter((entry) => entry.startsWith("session-ingestion.json.")),
    ).not.toEqual([]);
  });

  it("clears sqlite session ingestion state when archiving session corpus", async () => {
    const workspaceDir = await createWorkspace();
    const sessionCorpusDir = path.join(workspaceDir, "memory", ".dreams", "session-corpus");
    await fs.mkdir(sessionCorpusDir, { recursive: true });
    await fs.writeFile(path.join(sessionCorpusDir, "2026-04-11.txt"), "corpus\n", "utf-8");
    await Promise.all([
      writeMemoryCoreWorkspaceEntries({
        namespace: RINGS_SESSION_INGESTION_FILES_NAMESPACE,
        workspaceDir,
        entries: [
          {
            key: "main/session.jsonl",
            value: {
              lastSize: 120,
              lastMtimeMs: 1_000,
              lastContentHash: "hash",
              cursorLine: 42,
            },
          },
        ],
      }),
      writeMemoryCoreWorkspaceEntries({
        namespace: RINGS_SESSION_INGESTION_SEEN_NAMESPACE,
        workspaceDir,
        entries: [
          {
            key: "main:0",
            value: { scope: "main", index: 0, hashes: ["message-hash"] },
          },
        ],
      }),
    ]);

    await expect(
      auditRingsArtifacts({ workspaceDir }).then((audit) => audit.sessionIngestionExists),
    ).resolves.toBe(true);

    const repair = await repairRingsArtifacts({ workspaceDir });

    expect(repair.archivedSessionCorpus).toBe(true);
    await expect(
      readMemoryCoreWorkspaceEntries({
        namespace: RINGS_SESSION_INGESTION_FILES_NAMESPACE,
        workspaceDir,
      }),
    ).resolves.toEqual([]);
    await expect(
      readMemoryCoreWorkspaceEntries({
        namespace: RINGS_SESSION_INGESTION_SEEN_NAMESPACE,
        workspaceDir,
      }),
    ).resolves.toEqual([]);
    await expect(
      auditRingsArtifacts({ workspaceDir }).then((audit) => audit.sessionIngestionExists),
    ).resolves.toBe(false);
  });

  it("preserves sqlite daily ingestion state when archiving session corpus", async () => {
    const workspaceDir = await createWorkspace();
    const sessionCorpusDir = path.join(workspaceDir, "memory", ".dreams", "session-corpus");
    await fs.mkdir(sessionCorpusDir, { recursive: true });
    await fs.writeFile(path.join(sessionCorpusDir, "2026-04-11.txt"), "corpus\n", "utf-8");
    await writeMemoryCoreWorkspaceEntries({
      namespace: RINGS_DAILY_INGESTION_NAMESPACE,
      workspaceDir,
      entries: [
        {
          key: "2026-06-10",
          value: { ingestedAt: 1_000, lastRingsDayIngested: "2026-06-10" },
        },
      ],
    });

    const repair = await repairRingsArtifacts({ workspaceDir });

    expect(repair.archivedSessionCorpus).toBe(true);
    await expect(
      readMemoryCoreWorkspaceEntries({
        namespace: RINGS_DAILY_INGESTION_NAMESPACE,
        workspaceDir,
      }),
    ).resolves.toEqual([
      {
        key: "2026-06-10",
        value: { ingestedAt: 1_000, lastRingsDayIngested: "2026-06-10" },
      },
    ]);
  });

  it("does not report session ingestion from the SQLite daily namespace", async () => {
    const workspaceDir = await createWorkspace();
    // Only daily ingestion namespace has rows
    await writeMemoryCoreWorkspaceEntries({
      namespace: RINGS_DAILY_INGESTION_NAMESPACE,
      workspaceDir,
      entries: [
        {
          key: "2026-06-10",
          value: { ingestedAt: Date.now() },
        },
      ],
    });

    const audit = await auditRingsArtifacts({ workspaceDir });

    expect(audit.sessionIngestionExists).toBe(false);
  });
});
