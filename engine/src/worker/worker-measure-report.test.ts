import { describe, expect, it } from "vitest";
import {
  formatMeasurement,
  parseMemorySample,
  reportMeasurement,
} from "../../../scripts/measure-worker.mjs";

const sample = (rssBytes: number, peakBytes = rssBytes) => ({
  type: "worker-memory", rssBytes, peakBytes,
});
const measurement = (idleBytes = 200_000_000) => ({
  platform: "linux", arch: "x64", startupMs: 1234.6,
  idleSamples: [sample(idleBytes + 1), sample(idleBytes - 1), sample(idleBytes)],
  samples: [sample(idleBytes, 600_000_000)],
  proof: { providerCalls: 1, transcriptCommits: 2 },
});

describe("local worker memory report", () => {
  it.each(["win32", "darwin", "linux"])("reports RSS and start time on %s", platform => {
    const report = reportMeasurement({ ...measurement(), platform });
    expect(report).toMatchObject({ platform, idleRssBytes: 200_000_000,
      peakRssBytes: 600_000_000, startupMs: 1235, idleRssMB: 200,
      peakRssMB: 600, recommendation: "per-turn child" });
    expect(formatMeasurement(report)).toContain(`| ${platform} | x64 | 200 | 600 | 1235 | per-turn child |`);
    expect(JSON.stringify(report)).not.toMatch(/credential|workspaceDir|socketPath/);
  });

  it.each([399_999_999, 400_000_000, 400_000_001])("uses the card's strict 400 MB boundary at %s", bytes => {
    expect(reportMeasurement(measurement(bytes)).recommendation)
      .toBe(bytes < 400_000_000 ? "per-turn child" : "pooled worker");
  });

  it.each([null, {}, sample(0), sample(-1), sample(1.5), sample(100, 99),
    sample(Number.NaN), { ...sample(100), type: "other" }])("rejects malformed RSS samples: %j", value => {
    expect(() => parseMemorySample(value)).toThrow("Invalid worker memory sample");
  });

  it.each([
    { idleSamples: [] }, { samples: [] }, { startupMs: 0 }, { startupMs: Number.NaN },
    { proof: { providerCalls: 0, transcriptCommits: 1 } },
    { proof: { providerCalls: 1, transcriptCommits: 0 } },
    { samples: [sample(1)] },
  ])("refuses incomplete or contradictory measurement evidence: %j", invalid => {
    expect(() => reportMeasurement({ ...measurement(), ...invalid })).toThrow();
  });
});
