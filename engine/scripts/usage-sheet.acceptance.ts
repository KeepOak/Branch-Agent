import assert from "node:assert/strict";
import { it } from "node:test";
import { loadUsageSheet, type UsageSheetOptions } from "../src/shared/usage-sheet.js";
import type { SessionsUsageResult } from "../src/shared/usage-types.js";

function fixture(): SessionsUsageResult {
  const totals = { input: 3, output: 2, cacheRead: 1, cacheWrite: 0, totalTokens: 6, totalCost: 0.25, inputCost: 0.15, outputCost: 0.1, cacheReadCost: 0, cacheWriteCost: 0, missingCostEntries: 1 };
  return {
    updatedAt: 1, startDate: "2026-10-01", endDate: "2026-10-03", totals,
    sessions: [{ key: "agent:main:sheet", label: "=SUM(A1:A2)", usage: totals }],
    aggregates: { sessionCount: 1, messages: { total: 0, user: 0, assistant: 0, toolCalls: 0, toolResults: 0, errors: 0 }, tools: { totalCalls: 0, uniqueTools: 0, tools: [] }, byModel: [], byProvider: [], byAgent: [], byChannel: [], daily: [], costDaily: [{ ...totals, date: "2026-10-03" }] },
    cacheStatus: { status: "fresh", cachedFiles: 1, pendingFiles: 0, staleFiles: 0 },
  };
}
const options: UsageSheetOptions = { days: 7, kind: "daily", agentId: "main" };
const client = (report: SessionsUsageResult) => ({ request: async <T>() => report as T });

for (const days of [7, 30, 90] as const) it(`uses the existing owner-scoped RPC for ${days} days`, async () => {
  let request: unknown;
  const result = await loadUsageSheet({ request: async <T>(method: string, params: unknown) => { request = { method, params }; return fixture() as T; } }, { ...options, days });
  assert.deepEqual(request, { method: "sessions.usage", params: { range: `${days}d`, mode: "utc", groupBy: "instance", limit: 1000, agentId: "main" } });
  assert(result.filename.includes(`${days}days-daily-2026-10-03.csv`));
  assert(result.content.includes("2026-10-03,3,2,1,0,6,0.15,0.1,0,0,0.25"));
  assert.equal(result.missingCostEntries, 1);
});
it("preserves all-Trunk scope without widening the existing server authorization", async () => {
  let params: unknown;
  await loadUsageSheet({ request: async <T>(_method: string, query: unknown) => { params = query; return fixture() as T; } }, { days: 30, kind: "daily", agentScope: "all" });
  assert.deepEqual(params, { range: "30d", mode: "utc", groupBy: "instance", limit: 1000, agentScope: "all" });
  await assert.rejects(loadUsageSheet({ request: async () => { throw new Error("FORBIDDEN"); } }, options), /FORBIDDEN/);
});
it("retains formula protection in conversation sheets", async () => {
  const sheet = await loadUsageSheet(client(fixture()), { ...options, kind: "sessions" });
  assert(sheet.content.includes("'=SUM(A1:A2)"));
});
for (const status of ["partial", "stale", "refreshing"] as const) it(`rejects ${status} reports instead of exporting false zeroes`, async () => {
  const report = fixture(); report.cacheStatus!.status = status;
  await assert.rejects(loadUsageSheet(client(report), options), /refreshed/);
});
it("rejects incomplete session rows, but retains complete daily aggregates across the row cap", async () => {
  const report = fixture(); report.aggregates.sessionCount = 1001;
  await assert.rejects(loadUsageSheet(client(report), { ...options, kind: "sessions" }), /incomplete/);
  assert((await loadUsageSheet(client(report), options)).content.includes("2026-10-03"));
  report.aggregates.sessionCount = 1; report.sessions[0]!.usage = null;
  await assert.rejects(loadUsageSheet(client(report), { ...options, kind: "sessions" }), /incomplete/);
});
it("requires complete daily data and propagates engine failures", async () => {
  const report = fixture(); delete report.aggregates.costDaily;
  await assert.rejects(loadUsageSheet(client(report), options), /daily/);
  await assert.rejects(loadUsageSheet({ request: async () => { throw new Error("Engine disconnected"); } }, options), /disconnected/);
});
it("honors cancellation before and after the read", async () => {
  const before = new AbortController(); before.abort(); let called = false;
  await assert.rejects(loadUsageSheet({ request: async <T>() => { called = true; return fixture() as T; } }, { ...options, signal: before.signal }), { name: "AbortError" });
  assert.equal(called, false);
  const after = new AbortController();
  await assert.rejects(loadUsageSheet({ request: async <T>() => { after.abort(); return fixture() as T; } }, { ...options, signal: after.signal }), { name: "AbortError" });
});
it("freezes query and filename when the form changes during the read", async () => {
  const changing = { ...options };
  const result = await loadUsageSheet({ request: async <T>() => { changing.days = 90; changing.kind = "sessions"; return fixture() as T; } }, changing);
  assert(result.filename.includes("7days-daily"));
});
it("rejects invalid choices before calling the engine", async () => {
  let called = false;
  const fake = { request: async <T>() => { called = true; return fixture() as T; } };
  for (const invalid of [{ days: 1 }, { kind: "json" }, { agentId: "" }, { agentId: "main", agentScope: "all" }]) {
    await assert.rejects(loadUsageSheet(fake, { ...options, ...invalid } as UsageSheetOptions));
  }
  assert.equal(called, false);
});
it("rejects pending work even when the outer cache is labeled fresh", async () => {
  const report = fixture(); report.cacheStatus!.pendingFiles = 1;
  await assert.rejects(loadUsageSheet(client(report), options), /refreshed/);
  report.cacheStatus!.pendingFiles = 0; report.sessions[0]!.computing = true;
  await assert.rejects(loadUsageSheet(client(report), options), /refreshed/);
});
it("rejects a malformed response and preserves an honestly empty fresh report", async () => {
  await assert.rejects(loadUsageSheet(client({} as SessionsUsageResult), options), /complete usage report/);
  const report = fixture(); report.sessions = []; report.aggregates.sessionCount = 0; report.aggregates.costDaily = [];
  const sheet = await loadUsageSheet(client(report), { ...options, kind: "sessions" });
  assert.equal(sheet.content.split("\n").length, 1);
});
