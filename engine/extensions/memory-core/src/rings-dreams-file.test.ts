// Memory Core tests cover managed Dream Diary artifacts.
import fs from "node:fs/promises";
import path from "node:path";
import { createDeferred } from "branch/plugin-sdk/extension-shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appendNarrativeEntry,
  dedupeDreamDiaryEntries,
  readDreamsFile,
  readRecentDreamDiaryEntries,
  removeBackfillDiaryEntries,
  updateDeepDreamsFile,
  updateDreamsFile,
  writeBackfillDiaryEntries,
} from "./rings-dreams-file.js";
import {
  SHORT_TERM_LOCK_MAX_ENTRIES,
  SHORT_TERM_LOCK_NAMESPACE,
  memoryCoreWorkspaceStateKey,
  openMemoryCoreStateStore,
} from "./rings-state.js";
import { forgetMemoryEntries } from "./memory-forget.js";
import { createMemoryCoreTestHarness } from "./test-helpers.js";

const { createTempWorkspace } = createMemoryCoreTestHarness();
const EXPECTS_POSIX_PRIVATE_FILE_MODE = process.platform !== "win32";

function setNarrativeTestEnv(stateDir: string): void {
  vi.stubEnv("BRANCH_STATE_DIR", stateDir);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("dream diary file behavior", () => {
  it("reads and deduplicates a Windows-edited diary without losing surrounding notes", async () => {
    const workspaceDir = await createTempWorkspace("rings-diary-crlf-");
    const dreamsPath = path.join(workspaceDir, "DREAMS.md");
    const entry = "*April 5, 2026*\r\n\r\nA durable learned fact.";
    const before = "# Owner notes\r\nKeep this note verbatim.\r\n";
    const after = "\r\n## Deep Sleep\r\nKeep this summary verbatim.\r\n";
    await fs.writeFile(dreamsPath, before +
      "<!-- branch:rings:diary:start -->\r\n---\r\n\r\n" + entry +
      "\r\n\r\n---\r\n\r\n" + entry +
      "\r\n<!-- branch:rings:diary:end -->" + after);
    await expect(readRecentDreamDiaryEntries({ workspaceDir })).resolves.toHaveLength(2);
    const deduped = await dedupeDreamDiaryEntries({ workspaceDir });
    expect(deduped).toMatchObject({ removed: 1 });
    await expect(readRecentDreamDiaryEntries({ workspaceDir })).resolves.toEqual([
      "A durable learned fact.",
    ]);
    const updated = await fs.readFile(dreamsPath, "utf8");
    expect(updated.startsWith(before)).toBe(true);
    expect(updated.endsWith(after)).toBe(true);
    await expect(dedupeDreamDiaryEntries({ workspaceDir })).resolves.toMatchObject({ removed: 0 });
  });
  it("does not restore deleted diary content from an update already in progress", async () => {
    const workspaceDir = await createTempWorkspace("rings-forget-update-");
    setNarrativeTestEnv(path.join(workspaceDir, ".state"));
    const dreamsPath = path.join(workspaceDir, "DREAMS.md");
    const claim = "A private cobalt archive phrase.";
    await fs.writeFile(dreamsPath, `# Diary\n\n## Session ID: forgotten\n${claim}\n`);
    const prepared = createDeferred<void>();
    const publish = createDeferred<void>();
    const update = updateDreamsFile({
      workspaceDir,
      updater: async (existing) => {
        expect(existing).toContain(claim);
        prepared.resolve();
        await publish.promise;
        return { content: `${existing}\n## Other\nA new unrelated entry.\n`, result: undefined };
      },
    });
    let forgotten: ReturnType<typeof forgetMemoryEntries> | undefined;
    try {
      await prepared.promise;
      const writerOwnsLock = await openMemoryCoreStateStore({
        namespace: SHORT_TERM_LOCK_NAMESPACE,
        maxEntries: SHORT_TERM_LOCK_MAX_ENTRIES,
      }).lookup(memoryCoreWorkspaceStateKey(workspaceDir));
      forgotten = forgetMemoryEntries({
        cfg: { agents: { entries: { main: { workspace: workspaceDir } } } },
        agentId: "main",
        sessionIds: ["forgotten"],
      });
      if (!writerOwnsLock) {
        await forgotten;
      }
      publish.resolve();
      await Promise.all([update, forgotten]);
      const content = await fs.readFile(dreamsPath, "utf8");
      expect(content).not.toContain(claim);
      expect(content).toContain("A new unrelated entry.");
    } finally {
      publish.resolve();
      await Promise.allSettled([update, ...(forgotten ? [forgotten] : [])]);
    }
  });

  it("writes, reads, deduplicates, and removes backfill entries", async () => {
    const workspaceDir = await createTempWorkspace("rings-narrative-backfill-");
    const written = await writeBackfillDiaryEntries({
      workspaceDir,
      entries: [
        {
          isoDay: "2026-04-05",
          bodyLines: ["The archive remembered a durable fact."],
          sourcePath: "memory/2026-04-05.md",
        },
      ],
      timezone: "UTC",
    });
    expect(written.written).toBe(1);

    const existing = await fs.readFile(written.dreamsPath, "utf8");
    const startMarker = "<!-- branch:rings:diary:start -->";
    const endMarker = "<!-- branch:rings:diary:end -->";
    const block = existing.slice(
      existing.indexOf(startMarker) + startMarker.length,
      existing.indexOf(endMarker),
    );
    await fs.writeFile(written.dreamsPath, existing.replace(endMarker, `${block}\n${endMarker}`));

    await expect(dedupeDreamDiaryEntries({ workspaceDir })).resolves.toMatchObject({ removed: 1 });
    await expect(readRecentDreamDiaryEntries({ workspaceDir })).resolves.toHaveLength(1);
    await expect(removeBackfillDiaryEntries({ workspaceDir })).resolves.toMatchObject({
      removed: 1,
    });
  });

  it("refuses to overwrite a symlinked DREAMS.md", async () => {
    const workspaceDir = await createTempWorkspace("rings-narrative-symlink-");
    const targetPath = path.join(workspaceDir, "outside.txt");
    await fs.writeFile(targetPath, "outside\n", "utf8");
    await fs.symlink(targetPath, path.join(workspaceDir, "DREAMS.md"));

    await expect(
      writeBackfillDiaryEntries({
        workspaceDir,
        entries: [
          {
            isoDay: "2026-04-05",
            bodyLines: ["The archive remembered a durable fact."],
          },
        ],
        timezone: "UTC",
      }),
    ).rejects.toThrow("Refusing to write symlinked DREAMS.md");
    await expect(fs.readFile(targetPath, "utf8")).resolves.toBe("outside\n");
  });

  it.each([" 😀tail", "😀tail"])(
    "publishes unchanged truncated context ending in %s",
    async (suffix) => {
      const workspaceDir = await createTempWorkspace("rings-narrative-utf16-");
      const prefix = "a".repeat(359);
      const body = `${prefix}${suffix}`;
      await writeBackfillDiaryEntries({
        workspaceDir,
        entries: [
          {
            isoDay: "2026-04-05",
            bodyLines: [body],
          },
        ],
        timezone: "UTC",
      });

      const recentDiaryEntries = await readRecentDreamDiaryEntries({ workspaceDir, limit: 1 });
      expect(recentDiaryEntries).toEqual([`${prefix}...`]);
      await appendNarrativeEntry({
        workspaceDir,
        narrative: "Unchanged context must still publish.",
        nowMs: Date.parse("2026-04-06T03:00:00Z"),
        timezone: "UTC",
        recentDiaryEntries,
      });
      const content = await readDreamsFile(path.join(workspaceDir, "DREAMS.md"));
      expect(content).toContain("Unchanged context must still publish.");
      expect(content).toContain(body);
    },
  );

  it("skips symlinked and non-file DREAMS.md when reading recent context", async () => {
    const symlinkWorkspace = await createTempWorkspace("rings-narrative-read-symlink-");
    const targetPath = path.join(symlinkWorkspace, "target-dreams.md");
    await fs.writeFile(
      targetPath,
      [
        "# Dream Diary",
        "",
        "<!-- branch:rings:diary:start -->",
        "---",
        "",
        "*April 5, 2026*",
        "",
        "Symlink target diary text must not enter the prompt.",
        "",
        "<!-- branch:rings:diary:end -->",
        "",
      ].join("\n"),
      "utf8",
    );
    await fs.symlink(targetPath, path.join(symlinkWorkspace, "DREAMS.md"));

    await expect(
      readRecentDreamDiaryEntries({ workspaceDir: symlinkWorkspace, limit: 3 }),
    ).resolves.toEqual([]);

    const directoryWorkspace = await createTempWorkspace("rings-narrative-read-directory-");
    await fs.mkdir(path.join(directoryWorkspace, "DREAMS.md"));
    await expect(
      readRecentDreamDiaryEntries({ workspaceDir: directoryWorkspace, limit: 3 }),
    ).resolves.toEqual([]);
  });

  it.each(["EACCES", "EPERM"])("only optional diary context suppresses %s", async (code) => {
    const workspaceDir = await createTempWorkspace("rings-diary-read-permission-");
    const dreamsPath = path.join(workspaceDir, "DREAMS.md");
    await fs.writeFile(dreamsPath, "# Existing\n");
    const error = Object.assign(new Error("read denied"), { code });
    vi.spyOn(fs, "open").mockRejectedValue(error);

    await expect(readDreamsFile(dreamsPath)).rejects.toBe(error);
    await expect(readRecentDreamDiaryEntries({ workspaceDir })).resolves.toEqual([]);
  });

  it("propagates unexpected diary read failures through both public readers", async () => {
    const workspaceDir = await createTempWorkspace("rings-diary-read-error-");
    const dreamsPath = path.join(workspaceDir, "DREAMS.md");
    await fs.writeFile(dreamsPath, "# Existing\n");
    const error = Object.assign(new Error("read failed"), { code: "EIO" });
    vi.spyOn(fs, "open").mockRejectedValue(error);

    await expect(readDreamsFile(dreamsPath)).rejects.toBe(error);
    await expect(readRecentDreamDiaryEntries({ workspaceDir })).rejects.toBe(error);
  });

  it("preserves an undefined error code across optional context handling", async () => {
    const workspaceDir = await createTempWorkspace("rings-diary-error-code-");
    const code = vi
      .fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined)
      .mockReturnValue("ENOENT");
    const error = Object.defineProperty(new Error("read failed"), "code", { get: code });
    vi.spyOn(fs, "access").mockRejectedValueOnce(error);

    await expect(readRecentDreamDiaryEntries({ workspaceDir })).rejects.toBe(error);
    expect(code).toHaveBeenCalledTimes(2);
  });

  it("keeps existing content intact when the atomic replace fails", async () => {
    const workspaceDir = await createTempWorkspace("rings-narrative-atomic-");
    const dreamsPath = path.join(workspaceDir, "DREAMS.md");
    await fs.writeFile(dreamsPath, "# Existing\n", "utf8");
    vi.spyOn(fs, "rename").mockRejectedValueOnce(
      Object.assign(new Error("replace failed"), { code: "ENOSPC" }),
    );

    await expect(
      writeBackfillDiaryEntries({
        workspaceDir,
        entries: [
          {
            isoDay: "2026-04-05",
            bodyLines: ["The archive remembered a durable fact."],
          },
        ],
        timezone: "UTC",
      }),
    ).rejects.toThrow("replace failed");
    await expect(fs.readFile(dreamsPath, "utf8")).resolves.toBe("# Existing\n");
  });

  it("preserves restrictive DREAMS.md permissions across atomic replace", async () => {
    const workspaceDir = await createTempWorkspace("rings-narrative-mode-");
    const dreamsPath = path.join(workspaceDir, "DREAMS.md");
    await fs.writeFile(dreamsPath, "# Existing\n", { encoding: "utf8", mode: 0o600 });
    await fs.chmod(dreamsPath, 0o600);

    await writeBackfillDiaryEntries({
      workspaceDir,
      entries: [
        {
          isoDay: "2026-04-05",
          bodyLines: ["The archive remembered a durable fact."],
        },
      ],
      timezone: "UTC",
    });

    if (EXPECTS_POSIX_PRIVATE_FILE_MODE) {
      expect((await fs.stat(dreamsPath)).mode & 0o777).toBe(0o600);
    }
  });

  it("deduplicates exact matches while keeping distinct timestamps", async () => {
    const workspaceDir = await createTempWorkspace("rings-narrative-dedupe-");
    const dreamsPath = path.join(workspaceDir, "DREAMS.md");
    await fs.writeFile(
      dreamsPath,
      [
        "# Dream Diary",
        "",
        "<!-- branch:rings:diary:start -->",
        "---",
        "",
        "*April 11, 2026, 8:00 AM*",
        "",
        "The server room smelled like rain.",
        "",
        "---",
        "",
        "*April 11, 2026, 8:00 AM*",
        "",
        "<!-- transient comment -->",
        "",
        "The server room smelled like rain.",
        "",
        "---",
        "",
        "*April 11, 2026, 8:30 AM*",
        "",
        "The server room smelled like rain.",
        "",
        "<!-- branch:rings:diary:end -->",
        "",
      ].join("\n"),
      "utf8",
    );

    await expect(dedupeDreamDiaryEntries({ workspaceDir })).resolves.toMatchObject({
      removed: 1,
      kept: 2,
    });
    const content = await fs.readFile(dreamsPath, "utf8");
    expect(content.match(/The server room smelled like rain\./g)?.length).toBe(2);
    expect(content).toContain("*April 11, 2026, 8:00 AM*");
    expect(content).toContain("*April 11, 2026, 8:30 AM*");
  });

  it("serializes concurrent writes and deduplication", async () => {
    const workspaceDir = await createTempWorkspace("rings-narrative-concurrent-");
    const dreamsPath = path.join(workspaceDir, "DREAMS.md");
    await fs.writeFile(
      dreamsPath,
      [
        "# Dream Diary",
        "",
        "<!-- branch:rings:diary:start -->",
        "---",
        "",
        "*April 11, 2026, 8:00 AM*",
        "",
        "The server room smelled like rain.",
        "",
        "---",
        "",
        "*April 11, 2026, 8:00 AM*",
        "",
        "The server room smelled like rain.",
        "",
        "<!-- branch:rings:diary:end -->",
        "",
      ].join("\n"),
      "utf8",
    );

    await Promise.all([
      dedupeDreamDiaryEntries({ workspaceDir }),
      writeBackfillDiaryEntries({
        workspaceDir,
        entries: [
          {
            isoDay: "2026-04-11",
            bodyLines: ["A fresh signal arrived after the cleanup started."],
          },
        ],
        timezone: "UTC",
      }),
    ]);

    const content = await fs.readFile(dreamsPath, "utf8");
    expect(content.match(/The server room smelled like rain\./g)?.length).toBe(1);
    expect(content).toContain("A fresh signal arrived after the cleanup started.");
  });

  it("does not create the workspace when updateDreamsFile skips writing", async () => {
    const workspaceDir = path.join(await createTempWorkspace("rings-skip-no-dir-"), "pending");
    await updateDreamsFile({
      workspaceDir,
      updater: () => ({ content: "", result: undefined, shouldWrite: false }),
    });
    await expect(fs.access(workspaceDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not create memory/ or DREAMS.md when deep rings has no body lines", async () => {
    const workspaceDir = await createTempWorkspace("rings-empty-deep-");
    await updateDeepDreamsFile({ workspaceDir, bodyLines: [] });
    await expect(fs.access(path.join(workspaceDir, "memory"))).rejects.toThrow();
    await expect(fs.access(path.join(workspaceDir, "DREAMS.md"))).rejects.toThrow();
  });
});
