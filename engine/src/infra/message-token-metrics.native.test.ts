// kilocode_change - new file
import { describe, test as nativeTest } from "node:test";
import assert from "node:assert/strict";
const expect = (actual: unknown) => ({
  toBe: (expected: unknown) => assert.equal(actual, expected),
  toBeUndefined: () => assert.equal(actual, undefined),
  toBeCloseTo: (expected: number) => assert.ok(typeof actual === "number" && Math.abs(actual - expected) < 0.005),
});
const test = Object.assign(nativeTest, { each: (cases: readonly (readonly [number, string])[]) =>
  (name: string, fn: (input: number, expected: string) => void) => {
    for (const [input, expected] of cases) nativeTest(name.replace("%f", String(input)).replace("%s", expected), () => fn(input, expected));
  }
});
import { computeMetrics, formatRate, projectMessageTokenMetrics } from "./message-token-metrics.ts"

const tokens = {
  input: 100,
  output: 50,
  reasoning: 0,
  cache: { read: 0, write: 0 },
}

describe("kilocode.session.metrics.computeMetrics", () => {
  test("derives generation rate from elapsed time", () => {
    const metrics = computeMetrics({
      tokens: { ...tokens, output: 100 },
      elapsedMs: 1000,
    })
    expect(metrics?.source).toBe("computed")
    expect(metrics?.generation).toBeCloseTo(100)
    expect(metrics?.prompt).toBeUndefined()
  })

  test("returns undefined when there are no generation tokens", () => {
    const metrics = computeMetrics({
      tokens: { ...tokens, output: 0, reasoning: 0 },
      elapsedMs: 2000,
    })
    expect(metrics).toBeUndefined()
  })

  test("guards against zero elapsed time", () => {
    const metrics = computeMetrics({
      tokens: { ...tokens, output: 50 },
      elapsedMs: 0,
    })
    expect(metrics).toBeUndefined()
  })

  test("ignores providerMetadata until the upstream wiring lands (see #6579)", () => {
    // llama.cpp surfaces prompt_per_second / predicted_per_second, but the
    // upstream AI SDK drops them before the raw usage reaches our adapter.
    // Until a metadataExtractor is wired into createOpenAICompatible, the
    // provider source is unreachable — exercise the tolerance here.
    const metrics = computeMetrics({
      providerMetadata: {
        llama: { prompt_per_second: 412.3, predicted_per_second: 28.7 },
      },
      tokens: { ...tokens, output: 100 },
      elapsedMs: 2000,
    })
    expect(metrics?.source).toBe("computed")
    expect(metrics?.generation).toBeCloseTo(50)
    expect(metrics?.prompt).toBeUndefined()
  })

  test("tolerates missing providerMetadata", () => {
    const metrics = computeMetrics({
      tokens: { ...tokens, output: 200 },
      elapsedMs: 4000,
    })
    expect(metrics?.source).toBe("computed")
    expect(metrics?.generation).toBeCloseTo(50)
    expect(metrics?.prompt).toBeUndefined()
  })
})

describe("kilocode.session.metrics.formatRate", () => {
  test.each([
    [0, "0 t/s"],
    [12, "12 t/s"],
    [412.5, "412.5 t/s"],
    [12345, "12,345 t/s"],
  ] as const)("formats %f as %s", (input, expected) => {
    expect(formatRate(input)).toBe(expected)
  })

  test("returns zero string for negative inputs", () => {
    expect(formatRate(-5)).toBe("0 t/s")
  })
})
describe("Branch log metrics projection", () => {
  nativeTest("does not double-count reasoning already included in output", () => {
    assert.deepEqual(projectMessageTokenMetrics({role:"assistant",durationMs:1000,usage:{output:100,reasoningTokens:40}}),
      {durationMs:1000,metrics:{generation:100,source:"computed"}});
  });
  nativeTest("does not infer an absent duration", () => {
    assert.deepEqual(projectMessageTokenMetrics({role:"assistant",usage:{output:100}}), {});
  });
  nativeTest("does not attach assistant metrics to a user or tool", () => {
    for (const role of ["user","tool","toolResult"]) assert.deepEqual(projectMessageTokenMetrics({role,durationMs:1000,usage:{output:100}}), {});
  });
  nativeTest("preserves observed duration without fabricating missing token counts", () => {
    assert.deepEqual(projectMessageTokenMetrics({role:"assistant",durationMs:1000}), {durationMs:1000});
  });
  nativeTest("omits nonfinite, zero and negative elapsed samples", () => {
    for (const durationMs of [NaN,Infinity,0,-1]) assert.deepEqual(projectMessageTokenMetrics({role:"assistant",durationMs,usage:{output:100}}), {});
  });
  nativeTest("source includes separate reasoning tokens when its native buckets are passed", () => {
    assert.deepEqual(computeMetrics({elapsedMs:2000,tokens:{input:50,output:20,reasoning:80,cache:{read:0,write:0}}}), {generation:50,source:"computed"});
  });
});

// Exercise the exact current loader body with injected dependency boundaries.
// This is a consumer composition test, not a full Gateway/native SQLite import.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";
const reportingSource = fs.readFileSync(new URL("./session-cost-usage-reporting.ts", import.meta.url), "utf8");
const start = reportingSource.indexOf("export async function loadSessionLogs(");
assert.ok(start >= 0);
const loaderBody = stripTypeScriptTypes(reportingSource.slice(start).replace("export async", "async"));
const fixtureRead = async function* (file: string) {
  for (const line of fs.readFileSync(file,"utf8").trim().split("\n")) yield JSON.parse(line);
};
const loadFixtureLogs = new Function("fs", "projectMessageTokenMetrics", "resolveExistingUsageSessionFile", "parseSqliteSessionFileMarker",
  "resolveUsageCostAgentDir", "createUsageCostResolver", "readTranscriptRecordsBestEffort", "normalizeOptionalString",
  "isToolCallContentType", "stripUserEnvelopeForDisplay", "stripInboundMetadata", "truncateUtf16Safe",
  "parseUsageCostTranscriptEntryAsync", "computeUsageTokenTotals", loaderBody + "; return loadSessionLogs;")(
  fs, projectMessageTokenMetrics, (p: any) => p.sessionFile, () => null, () => "fixture", () => ({}), fixtureRead,
  (v: unknown) => typeof v === "string" ? v : undefined, () => false, (v: string) => v, (v: string) => v,
  (v: string,n: number) => v.slice(0,n), async (p: any) => ({ timestamp:new Date(p.timestamp),durationMs:p.message.durationMs,
    usage:p.message.usage,costTotal:p.message.cost }), (u: any) => ({totalTokens:u.total ?? 0}),
);

nativeTest("existing loader emits per-message timing/rate and preserves sorting and retention", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"branch-message-metrics-"));
  try {
    const file = path.join(dir,"transcript.jsonl");
    fs.writeFileSync(file,[
      {timestamp:3000,message:{role:"assistant",content:"last",durationMs:2000,usage:{output:100,reasoningTokens:20,total:200},cost:.5}},
      {timestamp:1000,message:{role:"assistant",content:"early",durationMs:1000,usage:{output:10,total:20}}},
      {timestamp:2000,message:{role:"user",content:"user",durationMs:1000,usage:{output:100,total:200}}},
    ].map(v=>JSON.stringify(v)).join("\n"));
    const logs=await loadFixtureLogs({sessionFile:file,agentId:"fixture",limit:2});
    assert.equal(logs.length,2); assert.equal(logs[0].content,"user");
    assert.equal(logs[0].metrics,undefined); assert.equal(logs[0].durationMs,undefined);
    assert.deepEqual(logs[1].metrics,{generation:50,source:"computed"});
    assert.equal(logs[1].durationMs,2000); assert.equal(logs[1].tokens,200); assert.equal(logs[1].cost,.5);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
nativeTest("existing loader does not fabricate rate for records lacking measured duration", async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"branch-message-metrics-"));
  try {
    const file=path.join(dir,"transcript.jsonl");
    fs.writeFileSync(file,JSON.stringify({timestamp:1000,message:{role:"assistant",content:"undated timing",usage:{output:100,total:200}}}));
    const [log]=await loadFixtureLogs({sessionFile:file,agentId:"fixture"});
    assert.equal(log.metrics,undefined); assert.equal(log.durationMs,undefined); assert.equal(log.tokens,200);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
