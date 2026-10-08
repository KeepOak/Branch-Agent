import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { totalmem } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const { availableMemoryBytes, candidateMinFreeBytes, CANDIDATE_MIN_FREE_MB_DEFAULT } =
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

test("Linux uses MemAvailable, not MemFree", () => {
  const strictlyFree = 80 * MIB;
  assert.equal(availableMemoryBytes({ platform: "linux", meminfo: linuxMeminfo, freemem: strictlyFree }), 8388608 * 1024);
});

test("macOS counts free, inactive and purgeable pages the OS can hand out", () => {
  const strictlyFree = 5120 * PAGE;
  assert.equal(
    availableMemoryBytes({ platform: "darwin", vmStat: macReport, freemem: strictlyFree }),
    (5120 + 371200 + 32768) * PAGE,
  );
});

test("macOS without a purgeable line still counts free and inactive pages", () => {
  const vmStat = [
    `Mach Virtual Memory Statistics: (page size of ${PAGE} bytes)`,
    "Pages free:                               5120.",
    "Pages inactive:                         371200.",
  ].join("\n");
  assert.equal(availableMemoryBytes({ platform: "darwin", vmStat, freemem: 0 }), (5120 + 371200) * PAGE);
});

test("Windows stays on os.freemem()", () => {
  assert.equal(availableMemoryBytes({ platform: "win32", meminfo: linuxMeminfo, vmStat: macReport, freemem: 7 * GIB }), 7 * GIB);
});

test("a failed or unreadable probe falls back to os.freemem()", () => {
  assert.equal(availableMemoryBytes({ platform: "linux", meminfo: "no counters here", freemem: 3 * GIB }), 3 * GIB);
  assert.equal(availableMemoryBytes({
    platform: "darwin",
    vmStat: "Mach Virtual Memory Statistics: (page size of 16384 bytes)\n",
    freemem: 2 * GIB,
  }), 2 * GIB);
});

test("the 16 GB Mac report from #459 has room once reclaimable pages count", () => {
  const strictlyFree = 5120 * PAGE;
  const available = availableMemoryBytes({ platform: "darwin", vmStat: macReport, freemem: strictlyFree });
  const min = candidateMinFreeBytes({ envMb: undefined, totalmem: 16 * GIB });
  assert.ok(strictlyFree < CANDIDATE_MIN_FREE_MB_DEFAULT * MIB, "old os.freemem() gate would skip");
  assert.ok(available >= min);
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

test("live measurement is a non-negative byte count at most total RAM", () => {
  const available = availableMemoryBytes();
  assert.ok(Number.isInteger(available) && available >= 0);
  assert.ok(available <= totalmem());
});

test("the candidate and standby gates use reclaimable memory", () => {
  const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/main.ts"), "utf8");
  assert.doesNotMatch(main, /\bfreemem\b/);
  assert.match(main, /availableMemoryBytes\(\)/);
  assert.match(main, /candidateMinFreeBytes\(\)/);
});
