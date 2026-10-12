// Ported from JuliusBrussee/caveman@b39c90862855ad2f0813ce775b8bf07a9d6d2a50:engine/compressors/log_test.go, log_match_test.go,
// lineends_test.go (TestLogCompressesMixedLineEndings) and redundancy_test.go (log cases) (atlas AGENT-LOOP-0349).
// Go byte slices become strings; invalid UTF-8 input becomes ill-formed UTF-16.
import { describe, expect, it } from "vitest";
import { compressLog, IMPORTANT_LINE_RE, importantLogLine } from "./log.js";

function noisyLog(): string {
  let b = "[INFO] starting\n";
  for (let i = 0; i < 50; i++) {
    b += `[INFO] step ${i} ok\n`;
  }
  b += "[ERROR] kaboom: undefined symbol\n";
  b += "  at frame (file.go:10)\n";
  b += "[INFO] done\n";
  return b;
}

describe("log compressor", () => {
  it("TestLogKeepsErrorsDropsNoise", () => {
    const out = compressLog(noisyLog());
    expect(out).toBeDefined();
    expect(out).toContain("[ERROR] kaboom");
    expect(out).toContain("undefined symbol");
    expect(out).toContain("lines elided (caveman)");
    expect(out!.length).toBeLessThan(noisyLog().length);
  });

  it("TestLogIdempotent", () => {
    const first = compressLog(noisyLog());
    expect(first).toBeDefined();
    const second = compressLog(first!);
    if (second !== undefined) {
      expect(second).toBe(first);
    }
  });

  it("TestLogPreservesCRLF", () => {
    let b = "[INFO] a\r\n";
    for (let i = 0; i < 20; i++) {
      b += `[INFO] noise ${i}\r\n`;
    }
    b += "[ERROR] bad\r\n";
    const out = compressLog(b);
    expect(out).toBeDefined();
    expect(out).toContain("\r\n");
    expect(out!.replaceAll("\r\n", "")).not.toContain("\n");
  });

  it("TestLogInvalidUTF8PassesThrough", () => {
    expect(compressLog("\uDFFF\uD800\u0000\u0001\n\uDFFF")).toBeUndefined();
  });

  it("TestLogTooShortPassesThrough", () => {
    expect(compressLog("[INFO] one\n[INFO] two\n")).toBeUndefined();
  });

  it("TestLogQueryKeepsRelevantNonErrorLine", () => {
    let b = "[INFO] starting\n";
    for (let i = 0; i < 50; i++) {
      b +=
        i === 27 ? "[INFO] websocket reconnect backoff selected\n" : `[INFO] routine worker ${i}\n`;
    }
    b += "[INFO] done\n";
    const out = compressLog(b, "websocket reconnect");
    expect(out).toBeDefined();
    expect(out).toContain("websocket reconnect backoff");
  });

  it("TestLogFastFilterMatchesCanonicalRegexp", () => {
    const words = [
      "ERROR",
      "FATAL",
      "PANIC",
      "EXCEPTION",
      "TRACEBACK",
      "FAIL",
      "FAILED",
      "FAILURE",
      "WARN",
      "WARNING",
      "ſailed",
      "tracebacK",
      "caused by",
      "file.go:12",
      "file.GO:12",
      "  at frame",
      '\tFile "x.py"',
      "  --->",
      "ordinary details",
      "",
      "é",
      "\xff",
    ];
    for (const word of words) {
      for (const spelling of [word, word.toLowerCase(), word.toUpperCase()]) {
        for (const prefix of ["", "[INFO] ", "x", "_", " ", "\t", "\n", "\f", "é"]) {
          for (const suffix of ["", " details", "x", "_", ":", "é"]) {
            const line = prefix + spelling + suffix;
            expect(importantLogLine(line), JSON.stringify(line)).toBe(IMPORTANT_LINE_RE.test(line));
          }
        }
      }
    }
  });

  it("TestLogCompressesMixedLineEndings", () => {
    let b = "";
    for (let i = 0; i < 200; i++) {
      b += `worker ${i}: waiting for the queue to drain${i % 40 === 0 ? "\r\n" : "\n"}`;
    }
    const out = compressLog(b);
    expect(out).toBeDefined();
    expect(out!.length).toBeLessThan(b.length);
  });
});

describe("log elision redundancy", () => {
  it("TestElisionTreatsDigitVaryingLinesAsOneClass", () => {
    let b = "";
    for (let i = 0; i < 200; i++) {
      const mm = String(Math.trunc(i / 60)).padStart(2, "0");
      const ss = String(i % 60).padStart(2, "0");
      b += `2026-07-30T10:${mm}:${ss}Z level=INFO service=catalog request=req-${String(i).padStart(4, "0")} status=200 message=completed\n`;
    }
    const out = compressLog(b);
    expect(out).toBeDefined();
    expect(out!.length * 4).toBeLessThanOrEqual(b.length);
  });

  it("TestElisionRefusesLogOfDistinctLines", () => {
    const input = [
      "2026-07-30T10:00:01Z level=INFO starting migration of the accounts table",
      "2026-07-30T10:00:02Z level=INFO connected to primary replica in frankfurt",
      "2026-07-30T10:00:03Z level=INFO applying column rename for customer identifiers",
      "2026-07-30T10:00:04Z level=INFO backfilling nullable settlement references",
      "2026-07-30T10:00:05Z level=INFO rebuilding the composite ordering index",
      "2026-07-30T10:00:06Z level=INFO vacuuming dead tuples from the audit journal",
      "2026-07-30T10:00:07Z level=INFO switching traffic to the upgraded schema",
      "2026-07-30T10:00:08Z level=INFO retiring the legacy compatibility view",
      "2026-07-30T10:00:09Z level=INFO refreshing materialised revenue rollups",
      "2026-07-30T10:00:10Z level=INFO releasing the advisory migration lock",
      "2026-07-30T10:00:11Z level=INFO notifying downstream consumers of the cutover",
      "2026-07-30T10:00:12Z level=INFO archiving the pre-migration snapshot to cold storage",
    ].join("\n");
    const out = compressLog(input);
    if (out !== undefined) {
      expect(out).toBe(input);
    }
  });

  it("TestElisionIsDeterministic", () => {
    let b = "";
    for (let i = 0; i < 120; i++) {
      b += `worker-${String(i % 7).padStart(2, "0")} processed batch ${String(i).padStart(4, "0")} in ${12 + (i % 40)}ms with status ok\n`;
    }
    for (let i = 0; i < 20; i++) {
      b += `distinct finding ${i}: ${"x".repeat(i + 1)}\n`;
    }
    const first = compressLog(b);
    expect(first).toBeDefined();
    for (let i = 0; i < 5; i++) {
      expect(compressLog(b)).toBe(first);
    }
  });
});
