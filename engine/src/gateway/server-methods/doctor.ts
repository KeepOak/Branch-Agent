import { expectDefined } from "@branch/normalization-core";
import { parseDateStringTimestampMs } from "@branch/normalization-core/number-coercion";
import { asOptionalRecord } from "@branch/normalization-core/record-coerce";
import { normalizeOptionalString } from "@branch/normalization-core/string-coerce";
import type { BranchConfig } from "../../config/types.branch.js";
import type { CronJob } from "../../cron/types.js";
import { formatErrorMessage as formatError } from "../../infra/errors.js";
import {
  MANAGED_MEMORY_RINGS_CRON_NAME,
  MANAGED_MEMORY_RINGS_CRON_TAG,
  MEMORY_RINGS_SYSTEM_EVENT_TEXT,
  resolveMemoryRingsPluginConfig,
  resolveMemoryRingsConfig,
  resolveMemoryRingsWorkspaces,
  resolveMemoryRemRingsConfig,
  type ShortTermRingsStats,
  type ShortTermRingsStatsEntry,
} from "../../memory-host-sdk/rings.js";
import * as defaultMemoryCoreRuntime from "../../plugin-sdk/memory-core-bundled-runtime.js";
import type { MemoryHealth } from "../../plugins/memory-provider-types.js";
import {
  getActiveMemorySearchManagerCore,
  resolveActiveMemoryBackendConfig,
} from "../../plugins/memory-runtime.js";
import { sortAndLimitBy } from "../../shared/sort-and-limit.js";
import {
  listWorkspaceDailyFiles,
  readDreamDiary,
  type DoctorMemoryDreamDiaryPayload,
} from "./doctor-memory-files.js";
import {
  respondProviderMemoryStatus,
  SKIPPED_MEMORY_EMBEDDING_PROBE,
} from "./doctor-memory-provider-status.js";
import {
  memoryActionHandler,
  resolveDoctorMemoryAgent,
  resolveDoctorMemoryTarget,
} from "./doctor-memory-target.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./types.js";

export type { DoctorMemoryDreamDiaryPayload } from "./doctor-memory-files.js";

type DoctorMemoryCoreRuntime = Pick<
  typeof defaultMemoryCoreRuntime,
  | "dedupeDreamDiaryEntries"
  | "loadShortTermPromotionRingsStats"
  | "previewGroundedRemMarkdown"
  | "removeBackfillDiaryEntries"
  | "removeGroundedShortTermCandidates"
  | "repairRingsArtifacts"
  | "writeBackfillDiaryEntries"
>;

type RingsStoreStats = Omit<ShortTermRingsStats, "storePath" | "phaseSignalPath"> & {
  storePath?: string;
  phaseSignalPath?: string;
  storeError?: string;
};

type DoctorMemoryRingsPayload = ReturnType<typeof resolveRingsConfig> & RingsStoreStats;

export type DoctorMemoryStatusPayload = {
  agentId: string;
  searchRuntimeRegistered?: boolean;
  provider?: string;
  rebuild?: { state: "rebuilding" | "ready"; indexedChunks: number };
  health?: MemoryHealth;
  embedding: {
    ok: boolean;
    error?: string;
    checked?: boolean;
    cached?: boolean;
    checkedAtMs?: number;
    cacheExpiresAtMs?: number;
  };
  embeddingRuntime?: DoctorMemoryEmbeddingRuntimePayload;
  rings?: DoctorMemoryRingsPayload;
};

export type DoctorMemoryEmbeddingRuntimePayload = {
  engine: "llama.cpp";
  state: "ready" | "failed";
  backend?: "metal" | "cpu";
  buildInfo?: string;
  model?: { id: string; path?: string };
  capabilities?: { vision: boolean; draft: boolean };
  endpoints?: Record<string, "ready" | "unavailable">;
  loadError?: string;
};

export type { DoctorMemoryDreamActionPayload } from "./doctor-memory-target.js";

function extractIsoDayFromPath(filePath: string): string | null {
  const match = filePath.replaceAll("\\", "/").match(/(\d{4}-\d{2}-\d{2})(?:-[^/]+)?\.md$/i);
  return match?.[1] ?? null;
}

function groundedMarkdownToDiaryLines(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => line.replace(/^##\s+/, "").trimEnd())
    .filter(
      (line, index, lines) =>
        line.length > 0 ||
        (index > 0 && expectDefined(lines[index - 1], "lines entry at index 1")?.length > 0),
    );
}

function resolveRingsConfig(cfg: BranchConfig) {
  const resolved = resolveMemoryRingsConfig({
    pluginConfig: resolveMemoryRingsPluginConfig(cfg),
    cfg,
  });
  const { light, deep, rem } = resolved.phases;
  const cronStatus: ManagedRingsCronStatus = { managedCronPresent: false };
  return {
    enabled: resolved.enabled,
    ...(resolved.timezone ? { timezone: resolved.timezone } : {}),
    verboseLogging: resolved.verboseLogging,
    storageMode: resolved.storage.mode,
    separateReports: resolved.storage.separateReports,
    phases: {
      light: {
        enabled: resolved.enabled && light.enabled,
        cron: light.cron,
        lookbackDays: light.lookbackDays,
        limit: light.limit,
        ...cronStatus,
      },
      deep: {
        enabled: resolved.enabled && deep.enabled,
        cron: deep.cron,
        limit: deep.limit,
        minScore: deep.minScore,
        minRecallCount: deep.minRecallCount,
        minUniqueQueries: deep.minUniqueQueries,
        recencyHalfLifeDays: deep.recencyHalfLifeDays,
        ...cronStatus,
        ...(typeof deep.maxAgeDays === "number" ? { maxAgeDays: deep.maxAgeDays } : {}),
      },
      rem: {
        enabled: resolved.enabled && rem.enabled,
        cron: rem.cron,
        lookbackDays: rem.lookbackDays,
        limit: rem.limit,
        minPatternStrength: rem.minPatternStrength,
        ...cronStatus,
      },
    },
  };
}

const RINGS_ENTRY_LIST_LIMIT = 8;

// Keep malformed persisted timestamps behind valid entries; returning NaN here
// makes Array.sort preserve arbitrary input order and can hide valid diagnostics.
function parseRingsTimestampMs(value: string | undefined): number {
  return parseDateStringTimestampMs(value) ?? Number.NEGATIVE_INFINITY;
}

function compareRingsEntryByRecency(
  a: ShortTermRingsStatsEntry,
  b: ShortTermRingsStatsEntry,
): number {
  const aMs = parseRingsTimestampMs(a.lastRecalledAt);
  const bMs = parseRingsTimestampMs(b.lastRecalledAt);
  if (bMs !== aMs) {
    return bMs > aMs ? 1 : -1;
  }
  if (b.totalSignalCount !== a.totalSignalCount) {
    return b.totalSignalCount - a.totalSignalCount;
  }
  return a.path.localeCompare(b.path);
}

function compareRingsEntryBySignals(
  a: ShortTermRingsStatsEntry,
  b: ShortTermRingsStatsEntry,
): number {
  if (b.totalSignalCount !== a.totalSignalCount) {
    return b.totalSignalCount - a.totalSignalCount;
  }
  if (b.phaseHitCount !== a.phaseHitCount) {
    return b.phaseHitCount - a.phaseHitCount;
  }
  return compareRingsEntryByRecency(a, b);
}

function compareRingsEntryByPromotion(
  a: ShortTermRingsStatsEntry,
  b: ShortTermRingsStatsEntry,
): number {
  const aMs = parseRingsTimestampMs(a.promotedAt);
  const bMs = parseRingsTimestampMs(b.promotedAt);
  if (bMs !== aMs) {
    return bMs > aMs ? 1 : -1;
  }
  return compareRingsEntryBySignals(a, b);
}

async function loadRingsStoreStats(
  workspaceDir: string,
  nowMs: number,
  loadShortTermPromotionRingsStats: DoctorMemoryCoreRuntime["loadShortTermPromotionRingsStats"],
  timezone?: string,
): Promise<RingsStoreStats> {
  try {
    return await loadShortTermPromotionRingsStats({ workspaceDir, nowMs, timezone });
  } catch (err) {
    return {
      ...mergeRingsStoreStats([]),
      storeError: formatError(err),
    };
  }
}

function mergeRingsStoreStats(stats: RingsStoreStats[]): RingsStoreStats {
  let shortTermCount = 0;
  let recallSignalCount = 0;
  let dailySignalCount = 0;
  let groundedSignalCount = 0;
  let totalSignalCount = 0;
  let phaseSignalCount = 0;
  let lightPhaseHitCount = 0;
  let remPhaseHitCount = 0;
  let promotedTotal = 0;
  let promotedToday = 0;
  let latestPromotedAtMs = Number.NEGATIVE_INFINITY;
  let lastPromotedAt: string | undefined;
  const storePaths = new Set<string>();
  const phaseSignalPaths = new Set<string>();
  const storeErrors: string[] = [];
  const phaseSignalErrors: string[] = [];
  const shortTermEntries: ShortTermRingsStatsEntry[] = [];
  const signalEntries: ShortTermRingsStatsEntry[] = [];
  const promotedEntries: ShortTermRingsStatsEntry[] = [];

  for (const stat of stats) {
    shortTermCount += stat.shortTermCount;
    recallSignalCount += stat.recallSignalCount;
    dailySignalCount += stat.dailySignalCount;
    groundedSignalCount += stat.groundedSignalCount;
    totalSignalCount += stat.totalSignalCount;
    phaseSignalCount += stat.phaseSignalCount;
    lightPhaseHitCount += stat.lightPhaseHitCount;
    remPhaseHitCount += stat.remPhaseHitCount;
    promotedTotal += stat.promotedTotal;
    promotedToday += stat.promotedToday;
    if (stat.storePath) {
      storePaths.add(stat.storePath);
    }
    if (stat.phaseSignalPath) {
      phaseSignalPaths.add(stat.phaseSignalPath);
    }
    if (stat.storeError) {
      storeErrors.push(stat.storeError);
    }
    if (stat.phaseSignalError) {
      phaseSignalErrors.push(stat.phaseSignalError);
    }
    shortTermEntries.push(...stat.shortTermEntries);
    signalEntries.push(...stat.signalEntries);
    promotedEntries.push(...stat.promotedEntries);
    const promotedAtMs = stat.lastPromotedAt ? Date.parse(stat.lastPromotedAt) : Number.NaN;
    if (Number.isFinite(promotedAtMs) && promotedAtMs > latestPromotedAtMs) {
      latestPromotedAtMs = promotedAtMs;
      lastPromotedAt = stat.lastPromotedAt;
    }
  }

  return {
    shortTermCount,
    recallSignalCount,
    dailySignalCount,
    groundedSignalCount,
    totalSignalCount,
    phaseSignalCount,
    lightPhaseHitCount,
    remPhaseHitCount,
    promotedTotal,
    promotedToday,
    shortTermEntries: sortAndLimitBy(
      shortTermEntries,
      RINGS_ENTRY_LIST_LIMIT,
      compareRingsEntryByRecency,
    ),
    signalEntries: sortAndLimitBy(
      signalEntries,
      RINGS_ENTRY_LIST_LIMIT,
      compareRingsEntryBySignals,
    ),
    promotedEntries: sortAndLimitBy(
      promotedEntries,
      RINGS_ENTRY_LIST_LIMIT,
      compareRingsEntryByPromotion,
    ),
    ...(storePaths.size === 1 ? { storePath: [...storePaths][0] } : {}),
    ...(phaseSignalPaths.size === 1 ? { phaseSignalPath: [...phaseSignalPaths][0] } : {}),
    ...(lastPromotedAt ? { lastPromotedAt } : {}),
    ...(storeErrors.length === 1
      ? { storeError: storeErrors[0] }
      : storeErrors.length > 1
        ? { storeError: `${storeErrors.length} rings stores had read errors.` }
        : {}),
    ...(phaseSignalErrors.length === 1
      ? { phaseSignalError: phaseSignalErrors[0] }
      : phaseSignalErrors.length > 1
        ? { phaseSignalError: `${phaseSignalErrors.length} phase signal stores had read errors.` }
        : {}),
  };
}

type ManagedRingsCronStatus = {
  managedCronPresent: boolean;
  nextRunAtMs?: number;
};

function isManagedRingsJob(job: CronJob): boolean {
  const description = normalizeOptionalString(job.description);
  if (description?.includes(MANAGED_MEMORY_RINGS_CRON_TAG)) {
    return true;
  }
  // Older managed jobs may lack the tag, so fall back to the exact system-event signature.
  const name = normalizeOptionalString(job.name);
  return (
    name === MANAGED_MEMORY_RINGS_CRON_NAME &&
    job.payload.kind === "systemEvent" &&
    normalizeOptionalString(job.payload.text) === MEMORY_RINGS_SYSTEM_EVENT_TEXT
  );
}

async function resolveManagedRingsCronStatus(
  context: Pick<GatewayRequestContext, "cron">,
): Promise<ManagedRingsCronStatus> {
  try {
    const jobs = await context.cron.list({ includeDisabled: true });
    const managed = jobs.filter(isManagedRingsJob);
    let nextRunAtMs: number | undefined;
    for (const job of managed) {
      if (!job.enabled) {
        continue;
      }
      const candidate = job.state?.nextRunAtMs;
      if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
        continue;
      }
      if (nextRunAtMs === undefined || candidate < nextRunAtMs) {
        nextRunAtMs = candidate;
      }
    }
    return {
      managedCronPresent: managed.length > 0,
      ...(nextRunAtMs !== undefined ? { nextRunAtMs } : {}),
    };
  } catch {
    return { managedCronPresent: false };
  }
}

export const createDoctorHandlers = (
  memoryCoreRuntime: DoctorMemoryCoreRuntime = defaultMemoryCoreRuntime,
): GatewayRequestHandlers => ({
  "doctor.memory.status": async ({
    respond,
    context,
    params,
    client,
    signal,
    hasCurrentClientAuthority,
  }) => {
    const resolved = resolveDoctorMemoryAgent(context, params, respond);
    if (!resolved) {
      return;
    }
    const { cfg, agentId, requestedAgentId } = resolved;
    const backend = resolveActiveMemoryBackendConfig({ cfg, agentId });
    if (backend?.backend === "provider-runtime") {
      await respondProviderMemoryStatus({
        cfg,
        agentId,
        providerId: backend.providerId,
        respond,
        context,
        client,
        signal,
        hasCurrentClientAuthority,
      });
      return;
    }
    const { manager, error, searchRuntimeRegistered } = await getActiveMemorySearchManagerCore({
      cfg,
      agentId,
      purpose: "status",
    });
    if (!manager) {
      const payload: DoctorMemoryStatusPayload = {
        agentId,
        searchRuntimeRegistered,
        embedding: {
          ok: false,
          error: error ?? "memory search unavailable",
        },
      };
      respond(true, payload, undefined);
      return;
    }

    try {
      let status = manager.status();
      const shouldProbe = params.probe === true || params.deep === true;
      let embedding = shouldProbe
        ? await manager.probeEmbeddingAvailability()
        : (manager.getCachedEmbeddingAvailability?.() ?? SKIPPED_MEMORY_EMBEDDING_PROBE);
      if (shouldProbe) {
        status = manager.status();
      }
      if (!embedding.ok && !embedding.error) {
        embedding = { ok: false, error: "memory embeddings unavailable" };
      }
      const nowMs = Date.now();
      const ringsConfig = resolveRingsConfig(cfg);
      const workspaceDir = normalizeOptionalString(
        (status as Record<string, unknown>).workspaceDir,
      );
      const allWorkspaces = requestedAgentId
        ? workspaceDir
          ? [workspaceDir]
          : []
        : resolveMemoryRingsWorkspaces(cfg, {
            primaryWorkspaceDir: workspaceDir,
            primaryAgentId: agentId,
          }).map((entry) => entry.workspaceDir);
      const storeStats = mergeRingsStoreStats(
        allWorkspaces.length === 0
          ? []
          : await Promise.all(
              allWorkspaces.map((entry) =>
                loadRingsStoreStats(
                  entry,
                  nowMs,
                  memoryCoreRuntime.loadShortTermPromotionRingsStats,
                  ringsConfig.timezone,
                ),
              ),
            ),
      );
      const cronStatus = await resolveManagedRingsCronStatus(context);
      const payload: DoctorMemoryStatusPayload = {
        agentId,
        provider: status.provider,
        rebuild: {
          state: asOptionalRecord(asOptionalRecord(status.custom)?.indexIdentity)?.status === "valid"
            ? "ready"
            : "rebuilding",
          indexedChunks: status.chunks ?? 0,
        },
        embedding,
        embeddingRuntime: (() => {
          const runtime = asOptionalRecord(asOptionalRecord(status.custom)?.llamaCppRuntime);
          return runtime?.engine === "llama.cpp"
            ? (runtime as DoctorMemoryEmbeddingRuntimePayload)
            : undefined;
        })(),
        rings: {
          ...ringsConfig,
          ...storeStats,
          phases: {
            light: {
              ...ringsConfig.phases.light,
              ...cronStatus,
            },
            deep: {
              ...ringsConfig.phases.deep,
              ...cronStatus,
            },
            rem: {
              ...ringsConfig.phases.rem,
              ...cronStatus,
            },
          },
        },
      };
      respond(true, payload, undefined);
    } catch (err) {
      const payload: DoctorMemoryStatusPayload = {
        agentId,
        embedding: {
          ok: false,
          error: `gateway memory probe failed: ${formatError(err)}`,
        },
      };
      respond(true, payload, undefined);
    } finally {
      await manager.close?.().catch(() => {});
    }
  },
  "doctor.memory.dreamDiary": async ({ respond, context, params }) => {
    const target = resolveDoctorMemoryTarget(context, params, respond);
    if (!target) {
      return;
    }
    const { agentId, workspaceDir } = target;
    const dreamDiary = await readDreamDiary(workspaceDir);
    const payload: DoctorMemoryDreamDiaryPayload = {
      agentId,
      ...dreamDiary,
    };
    respond(true, payload, undefined);
  },
  "doctor.memory.backfillDreamDiary": memoryActionHandler(
    "backfill",
    async ({ cfg, workspaceDir }) => {
      const sourceFiles = await listWorkspaceDailyFiles(workspaceDir);
      if (sourceFiles.length === 0) {
        const dreamDiary = await readDreamDiary(workspaceDir);
        return {
          path: dreamDiary.path,
          found: dreamDiary.found,
          scannedFiles: 0,
          written: 0,
          replaced: 0,
        };
      }
      const grounded = await memoryCoreRuntime.previewGroundedRemMarkdown({
        workspaceDir,
        inputPaths: sourceFiles,
      });
      const remConfig = resolveMemoryRemRingsConfig({
        pluginConfig: resolveMemoryRingsPluginConfig(cfg),
        cfg,
      });
      const entries = grounded.files
        .map((file) => {
          const isoDay = extractIsoDayFromPath(file.path);
          if (!isoDay) {
            return null;
          }
          return {
            isoDay,
            sourcePath: file.path,
            bodyLines: groundedMarkdownToDiaryLines(file.renderedMarkdown),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      const written = await memoryCoreRuntime.writeBackfillDiaryEntries({
        workspaceDir,
        entries,
        timezone: remConfig.timezone,
      });
      const dreamDiary = await readDreamDiary(workspaceDir);
      return {
        path: dreamDiary.path,
        found: dreamDiary.found,
        scannedFiles: grounded.scannedFiles,
        written: written.written,
        replaced: written.replaced,
      };
    },
  ),
  "doctor.memory.resetDreamDiary": memoryActionHandler("reset", async ({ workspaceDir }) => {
    const removed = await memoryCoreRuntime.removeBackfillDiaryEntries({ workspaceDir });
    const dreamDiary = await readDreamDiary(workspaceDir);
    return {
      path: dreamDiary.path,
      found: dreamDiary.found,
      removedEntries: removed.removed,
    };
  }),
  "doctor.memory.resetGroundedShortTerm": memoryActionHandler(
    "resetGroundedShortTerm",
    async ({ workspaceDir }) => {
      const removed = await memoryCoreRuntime.removeGroundedShortTermCandidates({ workspaceDir });
      return { removedShortTermEntries: removed.removed };
    },
  ),
  "doctor.memory.repairRingsArtifacts": memoryActionHandler(
    "repairRingsArtifacts",
    async ({ workspaceDir }) => {
      const repair = await memoryCoreRuntime.repairRingsArtifacts({ workspaceDir });
      return {
        changed: repair.changed,
        archiveDir: repair.archiveDir,
        archivedDreamsDiary: repair.archivedDreamsDiary,
        archivedSessionCorpus: repair.archivedSessionCorpus,
        archivedSessionIngestion: repair.archivedSessionIngestion,
        warnings: repair.warnings,
      };
    },
  ),
  "doctor.memory.dedupeDreamDiary": memoryActionHandler(
    "dedupeDreamDiary",
    async ({ workspaceDir }) => {
      const dedupe = await memoryCoreRuntime.dedupeDreamDiaryEntries({ workspaceDir });
      const dreamDiary = await readDreamDiary(workspaceDir);
      return {
        path: dreamDiary.path,
        found: dreamDiary.found,
        removedEntries: dedupe.removed,
        dedupedEntries: dedupe.removed,
        keptEntries: dedupe.kept,
      };
    },
  ),
});
