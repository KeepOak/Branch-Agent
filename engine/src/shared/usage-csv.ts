// Extracted from openclaw/openclaw@57e0aaa1c190f1abe16e597008fbcc14f5e609e3
// ui/src/pages/usage/query.ts. Shared by engine UI and the native window.
import { timestampMsToIsoString } from "@branch/normalization-core/number-coercion";
import type { CostUsageSummary } from "../infra/session-cost-usage.types.js";
import type { SessionUsageEntry } from "./usage-types.js";

type UsageSessionEntry = SessionUsageEntry;
type CostDailyEntry = CostUsageSummary["daily"][number];

function neutralizeSpreadsheetFormulaCell(value: string): string {
  return /^[ \t\r\n]*[=+\-@\uFF0B\uFF0D\uFF1D\uFF20]/u.test(value) ? `'${value}` : value;
}

function csvEscape(value: string, neutralizeFormulas = true): string {
  const safeValue = neutralizeFormulas ? neutralizeSpreadsheetFormulaCell(value) : value;
  if (/[",\r\n]/.test(safeValue)) {
    return `"${safeValue.replaceAll('"', '""')}"`;
  }
  return safeValue;
}

type CsvValue = string | number | undefined | null;

function toCsvRow(values: CsvValue[]): string {
  return values
    .map((value) => {
      if (value === undefined || value === null) {
        return "";
      }
      return csvEscape(String(value), typeof value === "string");
    })
    .join(",");
}

function buildCsv<Entry>(
  entries: Entry[],
  columns: Record<string, (entry: Entry) => CsvValue>,
): string {
  const readers = Object.values(columns);
  return [
    toCsvRow(Object.keys(columns)),
    ...entries.map((entry) => toCsvRow(readers.map((read) => read(entry)))),
  ].join("\n");
}

export const buildSessionsCsv = (sessions: UsageSessionEntry[]): string =>
  buildCsv(sessions, {
    key: (session) => session.key,
    label: (session) => session.label,
    agentId: (session) => session.agentId,
    channel: (session) => session.channel,
    provider: (session) => session.modelProvider ?? session.providerOverride,
    model: (session) => session.model ?? session.modelOverride,
    updatedAt: (session) => timestampMsToIsoString(session.updatedAt),
    durationMs: (session) => session.usage?.durationMs,
    messages: (session) => session.usage?.messageCounts?.total,
    errors: (session) => session.usage?.messageCounts?.errors,
    toolCalls: (session) => session.usage?.messageCounts?.toolCalls,
    inputTokens: (session) => session.usage?.input,
    outputTokens: (session) => session.usage?.output,
    cacheReadTokens: (session) => session.usage?.cacheRead,
    cacheWriteTokens: (session) => session.usage?.cacheWrite,
    totalTokens: (session) => session.usage?.totalTokens,
    totalCost: (session) => session.usage?.totalCost,
  });

export const buildDailyCsv = (daily: CostDailyEntry[]): string =>
  buildCsv(daily, {
    date: (day) => day.date,
    inputTokens: (day) => day.input,
    outputTokens: (day) => day.output,
    cacheReadTokens: (day) => day.cacheRead,
    cacheWriteTokens: (day) => day.cacheWrite,
    totalTokens: (day) => day.totalTokens,
    inputCost: (day) => day.inputCost,
    outputCost: (day) => day.outputCost,
    cacheReadCost: (day) => day.cacheReadCost,
    cacheWriteCost: (day) => day.cacheWriteCost,
    totalCost: (day) => day.totalCost,
  });

