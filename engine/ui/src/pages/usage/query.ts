import { buildDailyCsv, buildSessionsCsv } from "../../../../src/shared/usage-csv.js";
import { normalizeLowercaseStringOrEmpty } from "@branch/normalization-core/string-coerce";
import { extractQueryTerms } from "./helpers.ts";
import type { UsageAggregates } from "./types.ts";

type QuerySuggestion = {
  label: string;
  value: string;
};

type UsageFilterOptions = Record<"agent" | "channel" | "provider" | "model" | "tool", string[]>;

function appendFilterValues<T>(
  values: string[],
  entries: readonly T[],
  read: (entry: T) => string | undefined,
  limit = 12,
): void {
  for (const entry of entries) {
    if (values.length >= limit) {
      break;
    }
    const value = read(entry);
    if (value && !values.includes(value)) {
      values.push(value);
    }
  }
}

export function buildUsageFilterOptions(
  sessions: readonly UsageSessionEntry[],
  aggregates?: UsageAggregates | null,
): UsageFilterOptions {
  const options: UsageFilterOptions = { agent: [], channel: [], provider: [], model: [], tool: [] };
  appendFilterValues(options.agent, sessions, (session) => session.agentId, 6);
  appendFilterValues(options.channel, sessions, (session) => session.channel);
  appendFilterValues(options.provider, sessions, (session) => session.modelProvider);
  // Overrides follow every observed provider, preserving the menu's first-seen order.
  appendFilterValues(options.provider, sessions, (session) => session.providerOverride);
  appendFilterValues(options.provider, aggregates?.byProvider ?? [], (entry) => entry.provider);
  appendFilterValues(options.model, sessions, (session) => session.model);
  appendFilterValues(options.model, aggregates?.byModel ?? [], (entry) => entry.model);
  appendFilterValues(options.tool, aggregates?.tools.tools ?? [], (entry) => entry.name);
  return options;
}

const buildQuerySuggestions = (query: string, options: UsageFilterOptions): QuerySuggestion[] => {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }
  const tokens = extractQueryTerms(trimmed).map((term) => term.raw);
  const lastQueryWord = tokens.at(-1) ?? "";
  const [rawKey, rawValue] = lastQueryWord.includes(":")
    ? [
        lastQueryWord.slice(0, lastQueryWord.indexOf(":")),
        lastQueryWord.slice(lastQueryWord.indexOf(":") + 1),
      ]
    : ["", ""];

  const key = normalizeLowercaseStringOrEmpty(rawKey);
  const value = normalizeLowercaseStringOrEmpty(rawValue);

  if (!key) {
    return [
      "agent:",
      "channel:",
      "provider:",
      "model:",
      "tool:",
      "has:errors",
      "has:tools",
      "minTokens:",
      "maxCost:",
    ].map((suggestion) => ({ label: suggestion, value: suggestion }));
  }

  let candidates: string[];
  switch (key) {
    case "agent":
    case "channel":
    case "provider":
    case "model":
    case "tool":
      candidates = options[key].slice(0, 6);
      break;
    case "has":
      candidates = ["errors", "tools", "context", "usage", "model", "provider"];
      break;
    default:
      return [];
  }
  return candidates
    .filter((candidate) => !value || normalizeLowercaseStringOrEmpty(candidate).includes(value))
    .map((candidate) => ({ label: `${key}:${candidate}`, value: `${key}:${candidate}` }));
};

const applySuggestionToQuery = (query: string, suggestion: string): string => {
  const trimmed = query.trim();
  if (!trimmed) {
    return `${suggestion} `;
  }
  const tokens = extractQueryTerms(trimmed).map((term) => term.raw);
  tokens[tokens.length - 1] = suggestion;
  return `${tokens.join(" ")} `;
};

const removeQueryToken = (query: string, token: string): string => {
  const tokens = extractQueryTerms(query).map((term) => term.raw);
  const next = tokens.filter((entry) => entry !== token);
  return next.length ? `${next.join(" ")} ` : "";
};

const setQueryTokensForKey = (query: string, key: string, values: string[]): string => {
  const normalizedKey = normalizeLowercaseStringOrEmpty(key);
  const remaining = new Map(values.map((value) => [normalizeLowercaseStringOrEmpty(value), value]));
  const tokens: string[] = [];
  // Retained values keep their authored spelling and quotes; serialize only new selections.
  for (const term of extractQueryTerms(query)) {
    if (
      normalizeLowercaseStringOrEmpty(term.key ?? "") !== normalizedKey ||
      remaining.delete(normalizeLowercaseStringOrEmpty(term.value))
    ) {
      tokens.push(term.raw);
    }
  }
  const next = [...tokens, ...Array.from(remaining.values(), (value) => `${key}:${value}`)];
  return next.length ? `${next.join(" ")} ` : "";
};

export {
  applySuggestionToQuery,
  buildDailyCsv,
  buildQuerySuggestions,
  buildSessionsCsv,
  removeQueryToken,
  setQueryTokensForKey,
};
