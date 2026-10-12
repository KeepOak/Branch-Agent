import { parseBoolean } from "@branch/normalization-core/boolean-coercion";
import {
  parseStrictNonNegativeInteger,
  parseStrictPositiveInteger,
} from "@branch/normalization-core/number-coercion";
import { asNullableRecord } from "@branch/normalization-core/record-coerce";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalLowercaseString,
  normalizeOptionalString,
  normalizeStringifiedOptionalString,
} from "@branch/normalization-core/string-coerce";
import {
  listAgentIds,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../agents/agent-scope.js";
import { resolveWorkspaceStateIdentity } from "../agents/workspace-state-identity.js";
import type { BranchConfig } from "../config/types.branch.js";

export const DEFAULT_MEMORY_RINGS_FREQUENCY = "0 3 * * *";
export const DEFAULT_MEMORY_RINGS_PLUGIN_ID = "memory-core";
export const MANAGED_MEMORY_RINGS_CRON_NAME = "Memory Rings Promotion";
export const MANAGED_MEMORY_RINGS_CRON_TAG = "[managed-by=memory-core.short-term-promotion]";
export const MEMORY_RINGS_SYSTEM_EVENT_TEXT =
  "__branch_memory_core_short_term_promotion_dream__";
export const LEGACY_MEMORY_LIGHT_RINGS_CRON_NAME = "Memory Light Rings";
export const LEGACY_MEMORY_LIGHT_RINGS_CRON_TAG = "[managed-by=memory-core.rings.light]";
export const LEGACY_MEMORY_LIGHT_RINGS_EVENT_TEXT = "__branch_memory_core_light_sleep__";
export const LEGACY_MEMORY_REM_RINGS_CRON_NAME = "Memory REM Rings";
export const LEGACY_MEMORY_REM_RINGS_CRON_TAG = "[managed-by=memory-core.rings.rem]";
export const LEGACY_MEMORY_REM_RINGS_EVENT_TEXT = "__branch_memory_core_rem_sleep__";
const DEFAULT_MEMORY_DEEP_RINGS_LIMIT = 10;
// Deterministic calibration scores 3-day/3-query durable facts at 0.750-0.756,
// versus repeated filler at 0.489-0.549 and high-relevance one-offs at 0.529-0.606.
export const DEFAULT_MEMORY_DEEP_RINGS_MIN_SCORE = 0.75;
export const DEFAULT_MEMORY_DEEP_RINGS_MIN_RECALL_COUNT = 3;
export const DEFAULT_MEMORY_DEEP_RINGS_MIN_UNIQUE_QUERIES = 3;
export const DEFAULT_MEMORY_DEEP_RINGS_RECENCY_HALF_LIFE_DAYS = 14;
export const DEFAULT_MEMORY_DEEP_RINGS_MAX_PROMOTED_SNIPPET_TOKENS = 160;
const DEFAULT_MEMORY_DEEP_RINGS_MAX_PRIOR_ENTRY_LOSS_FRACTION = 0.25;

type MemoryRingsSpeed = "fast" | "balanced" | "slow";
type MemoryRingsThinking = "low" | "medium" | "high";
type MemoryRingsBudget = "cheap" | "medium" | "expensive";
type MemoryRingsStorageMode = "inline" | "separate" | "both";

type MemoryLightRingsSource = "daily" | "sessions" | "recall";
type MemoryDeepRingsSource = "daily" | "memory" | "sessions" | "logs" | "recall";
type MemoryRemRingsSource = "memory" | "daily" | "deep";

type MemoryRingsExecutionConfig = {
  speed: MemoryRingsSpeed;
  thinking: MemoryRingsThinking;
  budget: MemoryRingsBudget;
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  timeoutMs?: number;
};

export type MemoryRingsStorageConfig = {
  mode: MemoryRingsStorageMode;
  separateReports: boolean;
};

export type RingsArtifactsAuditIssue = {
  severity: "warn" | "error";
  code:
    | "rings-session-corpus-unreadable"
    | "rings-session-corpus-self-ingested"
    | "rings-session-ingestion-unreadable"
    | "rings-diary-unreadable";
  message: string;
  fixable: boolean;
};

export type RingsArtifactsAuditSummary = {
  dreamsPath?: string;
  sessionCorpusDir: string;
  sessionCorpusFileCount: number;
  suspiciousSessionCorpusFileCount: number;
  suspiciousSessionCorpusLineCount: number;
  sessionIngestionPath: string;
  sessionIngestionExists: boolean;
  issues: RingsArtifactsAuditIssue[];
};

export type RepairRingsArtifactsResult = {
  changed: boolean;
  archiveDir?: string;
  archivedDreamsDiary: boolean;
  archivedSessionCorpus: boolean;
  archivedSessionIngestion: boolean;
  archivedPaths: string[];
  warnings: string[];
};

export type ShortTermAuditIssue = {
  severity: "warn" | "error";
  code:
    | "recall-store-unreadable"
    | "recall-store-empty"
    | "recall-store-invalid"
    | "recall-store-dangling"
    | "recall-store-over-limit"
    | "recall-lock-stale"
    | "recall-lock-unreadable";
  message: string;
  fixable: boolean;
};

export type ShortTermAuditSummary<TConceptTagScripts = Record<string, unknown>> = {
  storePath: string;
  lockPath: string;
  updatedAt?: string;
  exists: boolean;
  entryCount: number;
  promotedCount: number;
  spacedEntryCount: number;
  conceptTaggedEntryCount: number;
  conceptTagScripts?: TConceptTagScripts;
  invalidEntryCount: number;
  danglingEntryCount?: number;
  issues: ShortTermAuditIssue[];
};

export type RepairShortTermPromotionArtifactsResult = {
  changed: boolean;
  removedInvalidEntries: number;
  removedDanglingEntries?: number;
  removedOverflowEntries?: number;
  rewroteStore: boolean;
  removedStaleLock: boolean;
};

export type ShortTermRingsStatsEntry = {
  key: string;
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
  recallCount: number;
  dailyCount: number;
  groundedCount: number;
  totalSignalCount: number;
  lightHits: number;
  remHits: number;
  phaseHitCount: number;
  promotedAt?: string;
  lastRecalledAt?: string;
};

export type ShortTermRingsStats = {
  shortTermCount: number;
  recallSignalCount: number;
  dailySignalCount: number;
  groundedSignalCount: number;
  totalSignalCount: number;
  phaseSignalCount: number;
  lightPhaseHitCount: number;
  remPhaseHitCount: number;
  promotedTotal: number;
  promotedToday: number;
  storePath: string;
  phaseSignalPath: string;
  phaseSignalError?: string;
  lastPromotedAt?: string;
  shortTermEntries: ShortTermRingsStatsEntry[];
  signalEntries: ShortTermRingsStatsEntry[];
  promotedEntries: ShortTermRingsStatsEntry[];
};

type MemoryLightRingsConfig = {
  enabled: boolean;
  cron: string;
  lookbackDays: number;
  limit: number;
  dedupeSimilarity: number;
  sources: MemoryLightRingsSource[];
  execution: MemoryRingsExecutionConfig;
};

type MemoryDeepRingsRecoveryConfig = {
  enabled: boolean;
  triggerBelowHealth: number;
  lookbackDays: number;
  maxRecoveredCandidates: number;
  minRecoveryConfidence: number;
  autoWriteMinConfidence: number;
};

type MemoryDeepRingsConfig = {
  enabled: boolean;
  cron: string;
  limit: number;
  minScore: number;
  minRecallCount: number;
  minUniqueQueries: number;
  recencyHalfLifeDays: number;
  maxAgeDays?: number;
  maxPromotedSnippetTokens?: number;
  maxPriorEntryLossFraction: number;
  sources: MemoryDeepRingsSource[];
  recovery: MemoryDeepRingsRecoveryConfig;
  execution: MemoryRingsExecutionConfig;
};

type MemoryRemRingsConfig = {
  enabled: boolean;
  cron: string;
  lookbackDays: number;
  limit: number;
  minPatternStrength: number;
  sources: MemoryRemRingsSource[];
  execution: MemoryRingsExecutionConfig;
};

export type MemoryRingsPhaseName = "light" | "deep" | "rem";

type MemoryRingsConfig = {
  enabled: boolean;
  frequency: string;
  timezone?: string;
  verboseLogging: boolean;
  storage: MemoryRingsStorageConfig;
  execution: {
    defaults: MemoryRingsExecutionConfig;
  };
  phases: {
    light: MemoryLightRingsConfig;
    deep: MemoryDeepRingsConfig;
    rem: MemoryRemRingsConfig;
  };
};

type MemoryRingsWorkspace = {
  workspaceDir: string;
  agentIds: string[];
};

type MemoryRingsWorkspaceOptions = {
  primaryWorkspaceDir?: string | null;
  primaryAgentId?: string | null;
  env?: NodeJS.ProcessEnv;
};

const DEFAULT_MEMORY_LIGHT_RINGS_SOURCES: MemoryLightRingsSource[] = [
  "daily",
  "sessions",
  "recall",
];
const DEFAULT_MEMORY_DEEP_RINGS_SOURCES: MemoryDeepRingsSource[] = [
  "daily",
  "memory",
  "sessions",
  "logs",
  "recall",
];
const DEFAULT_MEMORY_REM_RINGS_SOURCES: MemoryRemRingsSource[] = ["memory", "daily", "deep"];

function normalizeScore(value: unknown, fallback: number): number {
  const normalized = normalizeStringifiedOptionalString(value);
  if (typeof value === "string" && !normalized) {
    return fallback;
  }
  const num = typeof value === "string" ? Number(normalized) : Number(value);
  if (!Number.isFinite(num) || num < 0 || num > 1) {
    return fallback;
  }
  return num;
}

function normalizeStringArray<T extends string>(value: unknown, fallback: readonly T[]): T[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const normalized: T[] = [];
  for (const entry of value) {
    const normalizedEntry = normalizeOptionalLowercaseString(entry);
    const match = fallback.find((option) => option === normalizedEntry);
    if (match && !normalized.includes(match)) {
      normalized.push(match);
    }
  }
  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeChoice<T extends string>(value: unknown, choices: readonly T[]): T | undefined {
  const normalized = normalizeOptionalLowercaseString(value);
  return choices.find((choice) => choice === normalized);
}

function resolveExecutionConfig(
  value: unknown,
  fallback: MemoryRingsExecutionConfig,
): MemoryRingsExecutionConfig {
  const record = asNullableRecord(value);
  const maxOutputTokens = parseStrictPositiveInteger(record?.maxOutputTokens);
  const timeoutMs = parseStrictPositiveInteger(record?.timeoutMs);
  const temperatureRaw = record?.temperature;
  const temperature =
    typeof temperatureRaw === "number" && Number.isFinite(temperatureRaw) && temperatureRaw >= 0
      ? Math.min(2, temperatureRaw)
      : undefined;
  const model = normalizeOptionalString(record?.model) ?? fallback.model;

  return {
    speed: normalizeChoice(record?.speed, ["fast", "balanced", "slow"]) ?? fallback.speed,
    thinking: normalizeChoice(record?.thinking, ["low", "medium", "high"]) ?? fallback.thinking,
    budget: normalizeChoice(record?.budget, ["cheap", "medium", "expensive"]) ?? fallback.budget,
    ...(model ? { model } : {}),
    ...(typeof maxOutputTokens === "number" ? { maxOutputTokens } : {}),
    ...(typeof temperature === "number" ? { temperature } : {}),
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
  };
}

function formatLocalIsoDay(epochMs: number): string {
  const date = new Date(epochMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveMemoryRingsPluginId(
  cfg: BranchConfig | Record<string, unknown> | undefined,
): string {
  const root = asNullableRecord(cfg);
  const plugins = asNullableRecord(root?.plugins);
  const slots = asNullableRecord(plugins?.slots);
  const configuredSlot = normalizeOptionalString(slots?.memory);
  if (configuredSlot && normalizeLowercaseStringOrEmpty(configuredSlot) !== "none") {
    return configuredSlot;
  }
  return DEFAULT_MEMORY_RINGS_PLUGIN_ID;
}

export function resolveMemoryRingsPluginConfig(
  cfg: BranchConfig | Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const root = asNullableRecord(cfg);
  const plugins = asNullableRecord(root?.plugins);
  const entries = asNullableRecord(plugins?.entries);
  const pluginId = resolveMemoryRingsPluginId(cfg);
  const memoryPlugin = asNullableRecord(entries?.[pluginId]);
  return asNullableRecord(memoryPlugin?.config) ?? undefined;
}

export function resolveMemoryRingsConfig(params: {
  pluginConfig?: Record<string, unknown>;
  cfg?: BranchConfig;
}): MemoryRingsConfig {
  const rings = asNullableRecord(params.pluginConfig?.rings);
  const frequency =
    normalizeOptionalString(rings?.frequency) ?? DEFAULT_MEMORY_RINGS_FREQUENCY;
  const timezone =
    normalizeOptionalString(rings?.timezone) ??
    normalizeOptionalString(params.cfg?.agents?.defaults?.userTimezone);
  const storage = asNullableRecord(rings?.storage);
  const execution = asNullableRecord(rings?.execution);
  const phases = asNullableRecord(rings?.phases);
  const topLevelModel = normalizeOptionalString(rings?.model);

  const defaultExecution = resolveExecutionConfig(execution?.defaults, {
    speed: "balanced",
    thinking: "medium",
    budget: "medium",
    ...(topLevelModel ? { model: topLevelModel } : {}),
  });

  const light = asNullableRecord(phases?.light);
  const deep = asNullableRecord(phases?.deep);
  const rem = asNullableRecord(phases?.rem);
  const deepRecovery = asNullableRecord(deep?.recovery);
  const maxAgeDays = parseStrictPositiveInteger(deep?.maxAgeDays);
  const maxPromotedSnippetTokens = parseStrictPositiveInteger(deep?.maxPromotedSnippetTokens);

  return {
    enabled: parseBoolean(rings?.enabled) ?? true,
    frequency,
    ...(timezone ? { timezone } : {}),
    verboseLogging: parseBoolean(rings?.verboseLogging) ?? false,
    storage: {
      mode: normalizeChoice(storage?.mode, ["inline", "separate", "both"]) ?? "separate",
      separateReports: parseBoolean(storage?.separateReports) ?? false,
    },
    execution: {
      defaults: defaultExecution,
    },
    phases: {
      light: {
        enabled: parseBoolean(light?.enabled) ?? true,
        cron: frequency,
        lookbackDays: parseStrictNonNegativeInteger(light?.lookbackDays) ?? 2,
        limit: parseStrictNonNegativeInteger(light?.limit) ?? 100,
        dedupeSimilarity: normalizeScore(light?.dedupeSimilarity, 0.9),
        sources: normalizeStringArray(light?.sources, DEFAULT_MEMORY_LIGHT_RINGS_SOURCES),
        execution: resolveExecutionConfig(light?.execution, {
          ...defaultExecution,
          speed: "fast",
          thinking: "low",
          budget: "cheap",
        }),
      },
      deep: {
        enabled: parseBoolean(deep?.enabled) ?? true,
        cron: frequency,
        limit: parseStrictNonNegativeInteger(deep?.limit) ?? DEFAULT_MEMORY_DEEP_RINGS_LIMIT,
        minScore: normalizeScore(deep?.minScore, DEFAULT_MEMORY_DEEP_RINGS_MIN_SCORE),
        minRecallCount:
          parseStrictNonNegativeInteger(deep?.minRecallCount) ??
          DEFAULT_MEMORY_DEEP_RINGS_MIN_RECALL_COUNT,
        minUniqueQueries:
          parseStrictNonNegativeInteger(deep?.minUniqueQueries) ??
          DEFAULT_MEMORY_DEEP_RINGS_MIN_UNIQUE_QUERIES,
        recencyHalfLifeDays:
          parseStrictNonNegativeInteger(deep?.recencyHalfLifeDays) ??
          DEFAULT_MEMORY_DEEP_RINGS_RECENCY_HALF_LIFE_DAYS,
        maxAgeDays: maxAgeDays ?? 30,
        maxPromotedSnippetTokens:
          maxPromotedSnippetTokens ?? DEFAULT_MEMORY_DEEP_RINGS_MAX_PROMOTED_SNIPPET_TOKENS,
        maxPriorEntryLossFraction: normalizeScore(
          deep?.maxPriorEntryLossFraction,
          DEFAULT_MEMORY_DEEP_RINGS_MAX_PRIOR_ENTRY_LOSS_FRACTION,
        ),
        sources: normalizeStringArray(deep?.sources, DEFAULT_MEMORY_DEEP_RINGS_SOURCES),
        recovery: {
          enabled: parseBoolean(deepRecovery?.enabled) ?? true,
          triggerBelowHealth: normalizeScore(deepRecovery?.triggerBelowHealth, 0.35),
          lookbackDays: parseStrictNonNegativeInteger(deepRecovery?.lookbackDays) ?? 30,
          maxRecoveredCandidates:
            parseStrictNonNegativeInteger(deepRecovery?.maxRecoveredCandidates) ?? 20,
          minRecoveryConfidence: normalizeScore(deepRecovery?.minRecoveryConfidence, 0.9),
          autoWriteMinConfidence: normalizeScore(deepRecovery?.autoWriteMinConfidence, 0.97),
        },
        execution: resolveExecutionConfig(deep?.execution, {
          ...defaultExecution,
          speed: "balanced",
          thinking: "high",
          budget: "medium",
        }),
      },
      rem: {
        enabled: parseBoolean(rem?.enabled) ?? true,
        cron: frequency,
        lookbackDays: parseStrictNonNegativeInteger(rem?.lookbackDays) ?? 7,
        limit: parseStrictNonNegativeInteger(rem?.limit) ?? 10,
        minPatternStrength: normalizeScore(rem?.minPatternStrength, 0.75),
        sources: normalizeStringArray(rem?.sources, DEFAULT_MEMORY_REM_RINGS_SOURCES),
        execution: resolveExecutionConfig(rem?.execution, {
          ...defaultExecution,
          speed: "slow",
          thinking: "high",
          budget: "expensive",
        }),
      },
    },
  };
}

function resolveMemoryRingsPhaseConfig<T extends MemoryRingsPhaseName>(
  resolved: MemoryRingsConfig,
  phase: T,
) {
  return {
    ...resolved.phases[phase],
    enabled: resolved.enabled && resolved.phases[phase].enabled,
    ...(resolved.timezone ? { timezone: resolved.timezone } : {}),
    verboseLogging: resolved.verboseLogging,
    storage: resolved.storage,
  };
}

export function resolveMemoryDeepRingsConfig(params: {
  pluginConfig?: Record<string, unknown>;
  cfg?: BranchConfig;
}): MemoryDeepRingsConfig & {
  timezone?: string;
  verboseLogging: boolean;
  storage: MemoryRingsStorageConfig;
} {
  return resolveMemoryRingsPhaseConfig(resolveMemoryRingsConfig(params), "deep");
}

export function resolveMemoryLightRingsConfig(params: {
  pluginConfig?: Record<string, unknown>;
  cfg?: BranchConfig;
}): MemoryLightRingsConfig & {
  timezone?: string;
  verboseLogging: boolean;
  storage: MemoryRingsStorageConfig;
} {
  return resolveMemoryRingsPhaseConfig(resolveMemoryRingsConfig(params), "light");
}

export function resolveMemoryRemRingsConfig(params: {
  pluginConfig?: Record<string, unknown>;
  cfg?: BranchConfig;
}): MemoryRemRingsConfig & {
  timezone?: string;
  verboseLogging: boolean;
  storage: MemoryRingsStorageConfig;
} {
  return resolveMemoryRingsPhaseConfig(resolveMemoryRingsConfig(params), "rem");
}

let memoryRingsDayFormatter: { timezone: string; formatter: Intl.DateTimeFormat } | undefined;

export function formatMemoryRingsDay(epochMs: number, timezone?: string): string {
  if (!timezone) {
    return formatLocalIsoDay(epochMs);
  }
  try {
    // Cache only explicit timezones so host-local fallback follows timezone changes.
    if (memoryRingsDayFormatter?.timezone !== timezone) {
      memoryRingsDayFormatter = {
        timezone,
        formatter: new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }),
      };
    }
    const parts = memoryRingsDayFormatter.formatter.formatToParts(new Date(epochMs));
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const year = values.get("year");
    const month = values.get("month");
    const day = values.get("day");
    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Fall back to host-local day for invalid or unsupported timezones.
  }
  return formatLocalIsoDay(epochMs);
}

export function isSameMemoryRingsDay(
  firstEpochMs: number,
  secondEpochMs: number,
  timezone?: string,
): boolean {
  return (
    formatMemoryRingsDay(firstEpochMs, timezone) ===
    formatMemoryRingsDay(secondEpochMs, timezone)
  );
}

export function resolveMemoryRingsWorkspaces(
  cfg: BranchConfig,
  options: MemoryRingsWorkspaceOptions = {},
): MemoryRingsWorkspace[] {
  const agentIds = listAgentIds(cfg);
  if (agentIds.length === 0) {
    agentIds.push(resolveDefaultAgentId(cfg));
  }

  const byWorkspace = new Map<string, MemoryRingsWorkspace>();
  const addWorkspace = (workspaceDirRaw: string | undefined, agentIdRaw: string): void => {
    const workspaceDir = workspaceDirRaw?.trim();
    if (!workspaceDir) {
      return;
    }
    const agentId = normalizeOptionalLowercaseString(agentIdRaw) || resolveDefaultAgentId(cfg);
    const key = resolveWorkspaceStateIdentity(workspaceDir).workspacePath;
    const existing = byWorkspace.get(key);
    if (existing) {
      if (!existing.agentIds.includes(agentId)) {
        existing.agentIds.push(agentId);
      }
      return;
    }
    byWorkspace.set(key, { workspaceDir, agentIds: [agentId] });
  };

  for (const agentId of agentIds) {
    addWorkspace(resolveAgentWorkspaceDir(cfg, agentId, options.env), agentId);
  }
  const primaryWorkspaceDir = options.primaryWorkspaceDir?.trim();
  if (primaryWorkspaceDir) {
    addWorkspace(primaryWorkspaceDir, options.primaryAgentId ?? resolveDefaultAgentId(cfg));
  }
  return [...byWorkspace.values()];
}

export function resolveMemoryRingsWorkspace(
  cfg: BranchConfig,
  workspaceDir: string,
  options: MemoryRingsWorkspaceOptions = {},
): MemoryRingsWorkspace | undefined {
  const workspacePath = resolveWorkspaceStateIdentity(workspaceDir).workspacePath;
  return resolveMemoryRingsWorkspaces(cfg, options).find(
    (entry) => resolveWorkspaceStateIdentity(entry.workspaceDir).workspacePath === workspacePath,
  );
}
