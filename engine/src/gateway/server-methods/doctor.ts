import { expectDefined } from "@branch/normalization-core";
import { parseDateStringTimestampMs } from "@branch/normalization-core/number-coercion";
import { asOptionalRecord } from "@branch/normalization-core/record-coerce";
import { normalizeOptionalString } from "@branch/normalization-core/string-coerce";
import { ErrorCodes, errorShape } from "../../../packages/gateway-protocol/src/index.js";
import {
  AgentSelectionRequiredError,
  tryResolveAmbientOwnerAgentId,
} from "../../agents/agent-scope-config.js";
import {
  listAgentIds,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import type { BranchConfig } from "../../config/types.branch.js";
import { formatErrorMessage as formatError } from "../../infra/errors.js";
import {
  resolveMemoryRingsPluginConfig,
  resolveMemoryRingsConfig,
  resolveMemoryRingsWorkspaces,
  resolveMemoryRemRingsConfig,
  type ShortTermRingsStats,
  type ShortTermRingsStatsEntry,
} from "../../memory-host-sdk/rings.js";
import * as defaultMemoryCoreRuntime from "../../plugin-sdk/memory-core-bundled-runtime.js";
import { getActiveMemorySearchManagerCore } from "../../plugins/memory-runtime.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { sortAndLimitBy } from "../../shared/sort-and-limit.js";
import {
  listWorkspaceDailyFiles,
  readDreamDiary,
  type DoctorMemoryDreamDiaryPayload,
} from "./doctor-memory-files.js";
import type {
  GatewayRequestContext,
  GatewayRequestHandler,
  GatewayRequestHandlers,
  RespondFn,
} from "./types.js";

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

const MANAGED_DEEP_SLEEP_CRON_NAME = "Memory Rings Promotion";
const MANAGED_DEEP_SLEEP_CRON_TAG = "[managed-by=memory-core.short-term-promotion]";
const DEEP_SLEEP_SYSTEM_EVENT_TEXT = "__branch_memory_core_short_term_promotion_dream__";

type DoctorMemoryRingsPhasePayload = {
  enabled: boolean;
  cron: string;
  managedCronPresent: boolean;
  nextRunAtMs?: number;
};

type DoctorMemoryLightRingsPayload = DoctorMemoryRingsPhasePayload & {
  lookbackDays: number;
  limit: number;
};

type DoctorMemoryDeepRingsPayload = DoctorMemoryRingsPhasePayload & {
  minScore: number;
  minRecallCount: number;
  minUniqueQueries: number;
  recencyHalfLifeDays: number;
  maxAgeDays?: number;
  limit: number;
};

type DoctorMemoryRemRingsPayload = DoctorMemoryRingsPhasePayload & {
  lookbackDays: number;
  limit: number;
  minPatternStrength: number;
};

type RingsStoreStats = Omit<ShortTermRingsStats, "storePath" | "phaseSignalPath"> & {
  storePath?: string;
  phaseSignalPath?: string;
  storeError?: string;
};

type DoctorMemoryRingsConfigPayload = {
  enabled: boolean;
  timezone?: string;
  verboseLogging: boolean;
  storageMode: "inline" | "separate" | "both";
  separateReports: boolean;
  shortTermEntries: ShortTermRingsStatsEntry[];
  signalEntries: ShortTermRingsStatsEntry[];
  promotedEntries: ShortTermRingsStatsEntry[];
  phases: {
    light: DoctorMemoryLightRingsPayload;
    deep: DoctorMemoryDeepRingsPayload;
    rem: DoctorMemoryRemRingsPayload;
  };
};

type DoctorMemoryRingsPayload = DoctorMemoryRingsConfigPayload & RingsStoreStats;

export type DoctorMemoryStatusPayload = {
  agentId: string;
  searchRuntimeRegistered?: boolean;
  provider?: string;
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

export type DoctorMemoryDreamActionPayload = {
  agentId: string;
  action:
    | "backfill"
    | "reset"
    | "resetGroundedShortTerm"
    | "repairRingsArtifacts"
    | "dedupeDreamDiary";
  path?: string;
  found?: boolean;
  scannedFiles?: number;
  written?: number;
  replaced?: number;
  removedEntries?: number;
  removedShortTermEntries?: number;
  changed?: boolean;
  archiveDir?: string;
  archivedDreamsDiary?: boolean;
  archivedSessionCorpus?: boolean;
  archivedSessionIngestion?: boolean;
  warnings?: string[];
  dedupedEntries?: number;
  keptEntries?: number;
};

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

function resolveRingsConfig(cfg: BranchConfig): DoctorMemoryRingsConfigPayload {
  const resolved = resolveMemoryRingsConfig({
    pluginConfig: resolveMemoryRingsPluginConfig(cfg),
    cfg,
  });
  const { light, deep, rem } = resolved.phases;
  return {
    enabled: resolved.enabled,
    ...(resolved.timezone ? { timezone: resolved.timezone } : {}),
    verboseLogging: resolved.verboseLogging,
    storageMode: resolved.storage.mode,
    separateReports: resolved.storage.separateReports,
    shortTermEntries: [],
    signalEntries: [],
    promotedEntries: [],
    phases: {
      light: {
        enabled: resolved.enabled && light.enabled,
        cron: light.cron,
        lookbackDays: light.lookbackDays,
        limit: light.limit,
        managedCronPresent: false,
      },
      deep: {
        enabled: resolved.enabled && deep.enabled,
        cron: deep.cron,
        limit: deep.limit,
        minScore: deep.minScore,
        minRecallCount: deep.minRecallCount,
        minUniqueQueries: deep.minUniqueQueries,
        recencyHalfLifeDays: deep.recencyHalfLifeDays,
        managedCronPresent: false,
        ...(typeof deep.maxAgeDays === "number" ? { maxAgeDays: deep.maxAgeDays } : {}),
      },
      rem: {
        enabled: resolved.enabled && rem.enabled,
        cron: rem.cron,
        lookbackDays: rem.lookbackDays,
        limit: rem.limit,
        minPatternStrength: rem.minPatternStrength,
        managedCronPresent: false,
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

type ManagedCronJobLike = {
  name?: string;
  description?: string;
  enabled?: boolean;
  payload?: { kind?: string; text?: string };
  state?: { nextRunAtMs?: number };
};

function isManagedRingsJob(job: ManagedCronJobLike): boolean {
  const description = normalizeOptionalString(job.description);
  if (description?.includes(MANAGED_DEEP_SLEEP_CRON_TAG)) {
    return true;
  }
  // Older managed jobs may lack the tag, so fall back to the exact system-event signature.
  const name = normalizeOptionalString(job.name);
  const payloadKind = normalizeOptionalString(job.payload?.kind)?.toLowerCase();
  const payloadText = normalizeOptionalString(job.payload?.text);
  return (
    name === MANAGED_DEEP_SLEEP_CRON_NAME &&
    payloadKind === "systemevent" &&
    payloadText === DEEP_SLEEP_SYSTEM_EVENT_TEXT
  );
}

async function resolveManagedRingsCronStatus(context: {
  cron?: { list?: (opts?: { includeDisabled?: boolean }) => Promise<unknown[]> };
}): Promise<ManagedRingsCronStatus> {
  if (!context.cron || typeof context.cron.list !== "function") {
    return { managedCronPresent: false };
  }
  try {
    const jobs = await context.cron.list({ includeDisabled: true });
    const managed = jobs
      .filter((job): job is ManagedCronJobLike => typeof job === "object" && job !== null)
      .filter(isManagedRingsJob);
    let nextRunAtMs: number | undefined;
    for (const job of managed) {
      if (job.enabled !== true) {
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

function shouldProbeMemoryEmbeddings(params: unknown): boolean {
  if (!params || typeof params !== "object") {
    return false;
  }
  const record = params as Record<string, unknown>;
  return record.probe === true || record.deep === true;
}

function resolveDoctorMemoryAgent(
  context: GatewayRequestContext,
  params: unknown,
  respond: RespondFn,
  omittedAgentId?: string,
): {
  cfg: BranchConfig;
  agentId: string;
  requestedAgentId?: string;
} | null {
  const cfg = context.getRuntimeConfig();
  const record = asOptionalRecord(params);
  const rawAgentId = record?.agentId;
  // Validate before resolving workspace or manager state; both paths can create agent storage.
  if (rawAgentId !== undefined && typeof rawAgentId !== "string") {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "agentId must be a string"));
    return null;
  }
  const requestedAgentId =
    typeof rawAgentId === "string" ? normalizeAgentId(rawAgentId) : undefined;
  let agentId = requestedAgentId ?? omittedAgentId;
  if (!agentId) {
    try {
      agentId = resolveDefaultAgentId(cfg, {
        surface: "doctor memory",
        hint: "Pass agentId to select a configured agent.",
      });
    } catch (error) {
      if (!(error instanceof AgentSelectionRequiredError)) {
        throw error;
      }
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
      return null;
    }
  }
  if (requestedAgentId && !listAgentIds(cfg).includes(agentId)) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent id "${requestedAgentId}"`),
    );
    return null;
  }
  return { cfg, agentId, ...(requestedAgentId ? { requestedAgentId } : {}) };
}

function resolveDoctorMemoryTarget(
  context: GatewayRequestContext,
  params: unknown,
  respond: RespondFn,
): {
  cfg: BranchConfig;
  agentId: string;
  workspaceDir: string;
} | null {
  // Apply the same ambient-owner fallback that doctor.memory.status uses so
  // that legacy clients (e.g. embedded UI builds that pre-date the agent-
  // selection gate) do not get a hard rejection on multi-agent installs when
  // a single default agent can be unambiguously resolved.
  const omittedAgentId = tryResolveAmbientOwnerAgentId(context.getRuntimeConfig());
  const resolved = resolveDoctorMemoryAgent(context, params, respond, omittedAgentId);
  if (!resolved) {
    return null;
  }
  return {
    cfg: resolved.cfg,
    agentId: resolved.agentId,
    workspaceDir: resolveAgentWorkspaceDir(resolved.cfg, resolved.agentId),
  };
}

function memoryActionHandler(
  action: DoctorMemoryDreamActionPayload["action"],
  run: (
    target: NonNullable<ReturnType<typeof resolveDoctorMemoryTarget>>,
  ) => Promise<Omit<DoctorMemoryDreamActionPayload, "agentId" | "action">>,
): GatewayRequestHandler {
  return async ({ respond, context, params }) => {
    const target = resolveDoctorMemoryTarget(context, params, respond);
    if (!target) {
      return;
    }
    respond(true, { agentId: target.agentId, action, ...(await run(target)) }, undefined);
  };
}

const SKIPPED_MEMORY_EMBEDDING_PROBE = {
  ok: false,
  checked: false,
  error: "memory embedding readiness not checked; run `branch memory status --deep` to probe",
} as const;

export const createDoctorHandlers = (
  memoryCoreRuntime: DoctorMemoryCoreRuntime = defaultMemoryCoreRuntime,
): GatewayRequestHandlers => ({
  "doctor.memory.status": async ({ respond, context, params }) => {
    const omittedAgentId = tryResolveAmbientOwnerAgentId(context.getRuntimeConfig());
    const resolved = resolveDoctorMemoryAgent(context, params, respond, omittedAgentId);
    if (!resolved) {
      return;
    }
    const { cfg, agentId, requestedAgentId } = resolved;
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
      const shouldProbe = shouldProbeMemoryEmbeddings(params);
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
/* oxlint-disable max-lines -- TODO: split this grandfathered oversized file. */
