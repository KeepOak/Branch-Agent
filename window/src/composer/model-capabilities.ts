// Public models.list runtime metadata; a native runtime is not an API-provider login.
import { list, rec, str, type Rec } from "./engine";

const SOURCES = ["env", "agent", "defaults", "model", "provider", "implicit", "session", "session-key"] as const;
const REASONS = ["missing-auth", "auth-failed", "cooldown", "unsupported-runtime"] as const;
export type RuntimeSource = typeof SOURCES[number];
export type AvailabilityReason = typeof REASONS[number];
export type RuntimeInfo = { id: string; source: RuntimeSource; fallback?: "branch" | "none" };
type Choice = { id: string; label: string };
type ContextChoice = Choice & { contextWindow: number };

export type RuntimeCapabilities = {
  available?: boolean;
  unavailableReason?: AvailabilityReason;
  unavailableUntil?: number;
  supportsTools?: boolean;
  supportsFastMode?: boolean;
  contextWindow?: number;
  contextTokens?: number;
  thinkingLevels: Choice[];
  thinkingDefault?: string;
  contextWindows: ContextChoice[];
  contextWindowDefault?: string;
  serviceTiers: string[];
};
export type RuntimeChoice = RuntimeCapabilities & { agentRuntime: RuntimeInfo };
export type ModelRuntimeMetadata = RuntimeCapabilities & { agentRuntime?: RuntimeInfo; runtimeChoices: RuntimeChoice[] };

function readRuntime(value: unknown): RuntimeInfo | undefined {
  const r = rec(value);
  const id = str(r.id);
  const source = SOURCES.find((s) => s === r.source);
  if (!id.trim() || !source) return undefined;
  const fallback = r.fallback === "branch" || r.fallback === "none" ? r.fallback : undefined;
  return { id, source, ...(fallback ? { fallback } : {}) };
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function readChoices(value: unknown): Choice[] {
  return list(value).flatMap((r) => {
    const id = str(r.id), label = str(r.label);
    return id && label ? [{ id, label }] : [];
  });
}

function readContextChoices(value: unknown): ContextChoice[] {
  return list(value).flatMap((r) => {
    const id = str(r.id), label = str(r.label), contextWindow = positiveInteger(r.contextWindow);
    return id && label && contextWindow ? [{ id, label, contextWindow }] : [];
  });
}

function readCapabilities(r: Rec): RuntimeCapabilities {
  const unavailableReason = REASONS.find((reason) => reason === r.unavailableReason);
  const until = r.unavailableUntil;
  const contextWindow = positiveInteger(r.contextWindow), contextTokens = positiveInteger(r.contextTokens);
  const thinkingDefault = str(r.thinkingDefault), contextWindowDefault = str(r.contextWindowDefault);
  return {
    ...(typeof r.available === "boolean" ? { available: r.available } : {}),
    ...(unavailableReason ? { unavailableReason } : {}),
    ...(typeof until === "number" && Number.isSafeInteger(until) && until >= 0 ? { unavailableUntil: until } : {}),
    ...(typeof r.supportsTools === "boolean" ? { supportsTools: r.supportsTools } : {}),
    ...(typeof r.supportsFastMode === "boolean" ? { supportsFastMode: r.supportsFastMode } : {}),
    ...(contextWindow ? { contextWindow } : {}), ...(contextTokens ? { contextTokens } : {}),
    thinkingLevels: readChoices(r.thinkingLevels), ...(thinkingDefault ? { thinkingDefault } : {}),
    contextWindows: readContextChoices(r.contextWindows), ...(contextWindowDefault ? { contextWindowDefault } : {}),
    serviceTiers: Array.isArray(r.serviceTiers) ? r.serviceTiers.filter((t): t is string => typeof t === "string" && t.length > 0) : [],
  };
}

/** Preserve each advertised runtime separately; this reader never selects or changes one. */
export function readModelRuntimeMetadata(row: Rec): ModelRuntimeMetadata {
  const agentRuntime = readRuntime(row.agentRuntime);
  const runtimeChoices = list(row.runtimeChoices).flatMap((r) => {
    const runtime = readRuntime(r.agentRuntime);
    return runtime ? [{ ...readCapabilities(r), agentRuntime: runtime }] : [];
  });
  return { ...readCapabilities(row), ...(agentRuntime ? { agentRuntime } : {}), runtimeChoices };
}
