import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const { availableMemory, candidateCheckSkippedLine, candidateMinFreeBytes, CANDIDATE_MIN_FREE_MB_DEFAULT } =
  await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "available-memory.js")));

const GIB = 2 ** 30, MIB = 2 ** 20, PAGE = 16384;
const macReport = [
  `Mach Virtual Memory Statistics: (page size of ${PAGE} bytes)`,
  "Pages free:                               5120.",
  "Pages inactive:                         371200.",
  "Pages purgeable:                         32768.",
].join("\n");
const linuxMeminfo = [
  "MemTotal:       16777216 kB",
  "MemFree:           81920 kB",
  "MemAvailable:    8388608 kB",
  "Buffers:          123456 kB",
  "Cached:          4567890 kB",
].join("\n");

test("desktop packages the single canonical memory implementation", () => {
  const shared = readFileSync(new URL("../../engine/scripts/lib/available-memory.mjs", import.meta.url), "utf8");
  const packaged = readFileSync(join(process.env.BRANCH_DESKTOP_TEST_DIST, "available-memory-core.mjs"), "utf8");
  assert.equal(packaged, shared);
});

test("desktop packaging entrypoints include the canonical memory implementation", () => {
  const entrypoints = ["package.sh", "package.ps1", "release-build.mjs", "prepare-release-layout-tests.mjs"];
  const bypassed = entrypoints.filter((file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const directDesktopCompile = /\bnpx\s+tsc\s+-p\s+tsconfig\.json\b/u.test(source) ||
      /\b(?:desktopRoot|desktop)\b[^\r\n]*typescript[\\/]+bin[\\/]+tsc\b/u.test(source);
    return !/scripts[\\/]+build\.mjs/u.test(source) || directDesktopCompile;
  });
  assert.deepEqual(bypassed, [], "Packaging must use the build that includes the shared memory module");
});

test("Linux uses MemAvailable, not MemFree", () => {
  const strictlyFree = 80 * MIB;
  const memory = availableMemory({ platform: "linux", meminfo: linuxMeminfo, freemem: strictlyFree });
  assert.equal(memory.bytes, 8388608 * 1024);
  assert.equal(memory.measure, "MemAvailable");
});

test("macOS counts free, inactive and purgeable pages the OS can hand out", () => {
  const strictlyFree = 5120 * PAGE;
  const memory = availableMemory({ platform: "darwin", vmStat: macReport, freemem: strictlyFree });
  assert.equal(memory.bytes, (5120 + 371200 + 32768) * PAGE);
  assert.equal(memory.measure, "vm_stat");
});

test("macOS without a purgeable line still counts free and inactive pages", () => {
  const vmStat = [
    `Mach Virtual Memory Statistics: (page size of ${PAGE} bytes)`,
    "Pages free:                               5120.",
    "Pages inactive:                         371200.",
  ].join("\n");
  const memory = availableMemory({ platform: "darwin", vmStat, freemem: 0 });
  assert.equal(memory.bytes, (5120 + 371200) * PAGE);
  assert.equal(memory.measure, "vm_stat");
});

test("Windows stays on os.freemem()", () => {
  const memory = availableMemory({ platform: "win32", meminfo: linuxMeminfo, vmStat: macReport, freemem: 7 * GIB });
  assert.equal(memory.bytes, 7 * GIB);
  assert.equal(memory.measure, "os.freemem");
});

test("a failed or unreadable probe falls back to os.freemem()", () => {
  const linux = availableMemory({ platform: "linux", meminfo: "no counters here", freemem: 3 * GIB });
  assert.equal(linux.bytes, 3 * GIB);
  assert.equal(linux.measure, "os.freemem");
  const darwin = availableMemory({
    platform: "darwin",
    vmStat: "Mach Virtual Memory Statistics: (page size of 16384 bytes)\n",
    freemem: 2 * GIB,
  });
  assert.equal(darwin.bytes, 2 * GIB);
  assert.equal(darwin.measure, "os.freemem");
});

test("the 16 GB Mac report from #459 has room once reclaimable pages count", () => {
  const strictlyFree = 5120 * PAGE;
  const memory = availableMemory({ platform: "darwin", vmStat: macReport, freemem: strictlyFree });
  const min = candidateMinFreeBytes({ envMb: undefined, totalmem: 16 * GIB });
  assert.ok(strictlyFree < CANDIDATE_MIN_FREE_MB_DEFAULT * MIB, "old os.freemem() gate would skip");
  assert.equal(memory.measure, "vm_stat");
  assert.ok(memory.bytes >= min);
});

test("default threshold is a quarter of RAM, capped at 6 GB", () => {
  assert.equal(candidateMinFreeBytes({ envMb: undefined, totalmem: 8 * GIB }), 2 * GIB);
  assert.equal(candidateMinFreeBytes({ envMb: undefined, totalmem: 16 * GIB }), 4 * GIB);
  assert.equal(candidateMinFreeBytes({ envMb: undefined, totalmem: 32 * GIB }), CANDIDATE_MIN_FREE_MB_DEFAULT * MIB);
  assert.equal(CANDIDATE_MIN_FREE_MB_DEFAULT, 6144);
});

test("BRANCH_DESKTOP_CANDIDATE_MIN_FREE_MB stays an absolute megabyte floor", () => {
  assert.equal(candidateMinFreeBytes({ envMb: "0", totalmem: 16 * GIB }), 0);
  assert.equal(candidateMinFreeBytes({ envMb: "6144", totalmem: 8 * GIB }), CANDIDATE_MIN_FREE_MB_DEFAULT * MIB);
  assert.equal(candidateMinFreeBytes({ envMb: String(2 ** 40), totalmem: 16 * GIB }), 2 ** 40 * MIB);
});

test("the skip log names the measure that produced the byte count", () => {
  const mac = availableMemory({ platform: "darwin", vmStat: macReport, freemem: 80 * MIB });
  assert.equal(
    candidateCheckSkippedLine(mac.bytes, mac.measure),
    `candidate check skipped; ${Math.round(mac.bytes / MIB)} MB free (vm_stat)`,
  );
  const linux = availableMemory({ platform: "linux", meminfo: "unreadable", freemem: 324 * MIB });
  assert.equal(candidateCheckSkippedLine(linux.bytes, linux.measure), "candidate check skipped; 324 MB free (os.freemem)");
});

test("the candidate and standby gates use reclaimable memory and name the measure", () => {
  const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/main.ts"), "utf8");
  assert.doesNotMatch(main, /\bfreemem\b/);
  assert.match(main, /availableMemory\(\)/);
  assert.match(main, /candidateMinFreeBytes\(\)/);
  assert.match(main, /candidateCheckSkippedLine\(available, measure\)/);
});
