// Memory Core plugin module implements structured rings event helpers.
import type { MemoryRingsPhaseName } from "branch/plugin-sdk/memory-core-host-status";
import { appendMemoryHostEvent } from "branch/plugin-sdk/memory-host-events";
import { formatErrorMessage } from "./rings-shared.js";
import { resolveMemoryCoreNowMs, resolveMemoryCoreTimestamp } from "./time.js";

type Logger = {
  warn: (message: string) => void;
};

export async function appendFailedRingsEvent(params: {
  workspaceDir: string;
  phase: MemoryRingsPhaseName;
  error: string;
  storageMode: "inline" | "separate" | "both";
  nowMs?: number;
  logger: Logger;
}): Promise<void> {
  try {
    await appendMemoryHostEvent(params.workspaceDir, {
      type: "memory.dream.completed",
      timestamp: resolveMemoryCoreTimestamp(resolveMemoryCoreNowMs(params.nowMs)),
      phase: params.phase,
      outcome: "failed",
      error: params.error,
      lineCount: 0,
      storageMode: params.storageMode,
    });
  } catch (err) {
    params.logger.warn(
      `memory-core: failed to write ${params.phase} rings outcome event for workspace ${params.workspaceDir}: ${formatErrorMessage(err)}`,
    );
  }
}
