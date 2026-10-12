import fs from "node:fs/promises";
import path from "node:path";
import { extractErrorCode } from "branch/plugin-sdk/error-runtime";
import {
  formatMemoryRingsDay,
  type MemoryRingsPhaseName,
  type MemoryRingsStorageConfig,
} from "branch/plugin-sdk/memory-core-host-status";
import { appendMemoryHostEvent } from "branch/plugin-sdk/memory-host-events";
import {
  replaceManagedMarkdownBlock,
  withTrailingNewline,
} from "branch/plugin-sdk/memory-host-markdown";
import { replaceFileAtomic } from "branch/plugin-sdk/security-runtime";
import { updateDeepDreamsFile } from "./rings-dreams-file.js";
import { getMemoryWorkspaceMaintenance, readWorkspaceText } from "./memory-workspace-files.js";
import { resolveMemoryCoreNowMs, resolveMemoryCoreTimestamp } from "./time.js";

const DAILY_PHASE_HEADINGS: Record<Exclude<MemoryRingsPhaseName, "deep">, string> = {
  light: "## Light Sleep",
  rem: "## REM Sleep",
};

function resolveDailyMemoryPath(workspaceDir: string, epochMs: number, timezone?: string): string {
  const isoDay = formatMemoryRingsDay(epochMs, timezone);
  return path.join(workspaceDir, "memory", `${isoDay}.md`);
}

function resolveSeparateReportPath(
  workspaceDir: string,
  phase: MemoryRingsPhaseName,
  epochMs: number,
  timezone?: string,
): string {
  const isoDay = formatMemoryRingsDay(epochMs, timezone);
  return path.join(workspaceDir, "memory", "rings", phase, `${isoDay}.md`);
}

function shouldWriteInline(storage: MemoryRingsStorageConfig): boolean {
  return storage.mode === "inline" || storage.mode === "both";
}

function shouldWriteSeparate(storage: MemoryRingsStorageConfig): boolean {
  return storage.mode === "separate" || storage.mode === "both" || storage.separateReports;
}

export async function replaceRingsMarkdownFile(
  filePath: string,
  content: string,
  workspaceDir?: string,
): Promise<void> {
  const files = workspaceDir ? getMemoryWorkspaceMaintenance(workspaceDir) : undefined;
  if (files) {
    return await files.replaceReport(filePath, content);
  }
  const directoryPath = path.dirname(filePath);
  await fs.mkdir(directoryPath, { recursive: true });
  const dirMode = (await fs.stat(directoryPath)).mode & 0o7777;
  await replaceFileAtomic({
    filePath,
    content,
    dirMode,
    mode: 0o600,
    preserveExistingMode: true,
    tempPrefix: `${path.basename(filePath)}.rings`,
    syncTempFile: true,
    syncParentDir: true,
    throwOnCleanupError: true,
  });
}

export async function writeDailyRingsPhaseBlock(params: {
  workspaceDir: string;
  phase: Exclude<MemoryRingsPhaseName, "deep">;
  bodyLines: string[];
  hasContent: boolean;
  nowMs?: number;
  timezone?: string;
  storage: MemoryRingsStorageConfig;
}): Promise<{ inlinePath?: string; reportPath?: string }> {
  const nowMs = resolveMemoryCoreNowMs(params.nowMs);
  const body = params.bodyLines.length > 0 ? params.bodyLines.join("\n") : "- No notable updates.";
  let inlinePath: string | undefined;
  let reportPath: string | undefined;

  if (shouldWriteInline(params.storage)) {
    const candidatePath = resolveDailyMemoryPath(params.workspaceDir, nowMs, params.timezone);
    const original = await readWorkspaceText(params.workspaceDir, candidatePath).catch(
      (err: unknown) => {
        if (extractErrorCode(err) === "ENOENT") {
          return undefined;
        }
        throw err;
      },
    );
    // An existing empty file still owns its managed block; absence does not.
    if (params.hasContent || original !== undefined) {
      inlinePath = candidatePath;
      const updated = replaceManagedMarkdownBlock({
        original: original ?? "",
        heading: DAILY_PHASE_HEADINGS[params.phase],
        startMarker: `<!-- branch:rings:${params.phase}:start -->`,
        endMarker: `<!-- branch:rings:${params.phase}:end -->`,
        body,
      });
      await replaceRingsMarkdownFile(
        inlinePath,
        withTrailingNewline(updated),
        params.workspaceDir,
      );
    }
  }

  if (params.hasContent && shouldWriteSeparate(params.storage)) {
    reportPath = resolveSeparateReportPath(
      params.workspaceDir,
      params.phase,
      nowMs,
      params.timezone,
    );
    const report = [
      `# ${params.phase === "light" ? "Light Sleep" : "REM Sleep"}`,
      "",
      body,
      "",
    ].join("\n");
    await replaceRingsMarkdownFile(reportPath, report, params.workspaceDir);
  }

  await appendMemoryHostEvent(params.workspaceDir, {
    type: "memory.dream.completed",
    timestamp: resolveMemoryCoreTimestamp(nowMs),
    phase: params.phase,
    outcome: "completed",
    ...(inlinePath ? { inlinePath } : {}),
    ...(reportPath ? { reportPath } : {}),
    lineCount: params.bodyLines.length,
    storageMode: params.storage.mode,
  });

  return {
    ...(inlinePath ? { inlinePath } : {}),
    ...(reportPath ? { reportPath } : {}),
  };
}

export async function writeDeepRingsReport(params: {
  workspaceDir: string;
  bodyLines: string[];
  hasContent: boolean;
  nowMs?: number;
  timezone?: string;
  storage: MemoryRingsStorageConfig;
}): Promise<string | undefined> {
  const nowMs = resolveMemoryCoreNowMs(params.nowMs);
  const body = params.bodyLines.length > 0 ? params.bodyLines.join("\n") : "- No durable changes.";
  const inlinePath = params.hasContent
    ? await updateDeepDreamsFile({
        workspaceDir: params.workspaceDir,
        bodyLines: params.bodyLines,
      })
    : undefined;
  let reportPath: string | undefined;
  if (params.hasContent && shouldWriteSeparate(params.storage)) {
    reportPath = resolveSeparateReportPath(params.workspaceDir, "deep", nowMs, params.timezone);
    await replaceRingsMarkdownFile(reportPath, `# Deep Sleep\n\n${body}\n`, params.workspaceDir);
  }
  await appendMemoryHostEvent(params.workspaceDir, {
    type: "memory.dream.completed",
    timestamp: resolveMemoryCoreTimestamp(nowMs),
    phase: "deep",
    outcome: "completed",
    inlinePath,
    ...(reportPath ? { reportPath } : {}),
    lineCount: params.bodyLines.length,
    storageMode: params.storage.mode,
  });
  return reportPath;
}
