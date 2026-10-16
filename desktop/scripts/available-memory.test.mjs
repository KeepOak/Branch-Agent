import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Set BRANCH_DESKTOP_TEST_DIST to the strict-compiled current source output");
const { availableMemory, candidateCheckSkippedLine, candidateMinFreeBytes, measureAvailableMemory, CANDIDATE_MIN_FREE_MB_DEFAULT, HEALTH_MEMORY_MAX_AGE_MS } =
  await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "available-memory.js")));
const { readUpdateHealth, updateHealthRefusal } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "auto-apply-update.js")));

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

test("Windows with no Available Bytes reading yet stays on os.freemem()", () => {
  const memory = availableMemory({ platform: "win32", meminfo: linuxMeminfo, vmStat: macReport, freemem: 7 * GIB, now: 0 });
  assert.equal(memory.bytes, 7 * GIB);
  assert.equal(memory.measure, "os.freemem");
});

test("Windows counts standby: the Legion's 389 MB free with 15 GB available passes both gates (Private #1054)", () => {
  const strictlyFree = 389 * MIB, total = 32 * GIB;
  const memory = availableMemory({ platform: "win32", windowsAvailable: `${15 * GIB}\r\n`, freemem: strictlyFree, totalmem: total });
  assert.equal(memory.bytes, 15 * GIB);
  assert.equal(memory.measure, "AvailableBytes");
  assert.ok(memory.bytes >= candidateMinFreeBytes({ envMb: undefined, totalmem: total }), "the candidate check runs");
  assert.ok(strictlyFree < candidateMinFreeBytes({ envMb: undefined, totalmem: total }), "old os.freemem() gate would skip");
  // The 20% health rule (#1428) still applies, now to available memory.
  assert.equal(updateHealthRefusal(readUpdateHealth(process.cwd(), memory.bytes, total, { BRANCH_DESKTOP_UPDATE_FREE_DISK: "0.5" })), undefined);
  assert.equal(updateHealthRefusal(readUpdateHealth(process.cwd(), strictlyFree, total, { BRANCH_DESKTOP_UPDATE_FREE_DISK: "0.5" })), "low memory: 1% free, under 20%");
  assert.equal(updateHealthRefusal(readUpdateHealth(process.cwd(), 6 * GIB, total, { BRANCH_DESKTOP_UPDATE_FREE_DISK: "0.5" })), "low memory: 19% free, under 20%");
  assert.equal(candidateCheckSkippedLine(400 * MIB, "AvailableBytes"), "candidate check skipped; 400 MB free (AvailableBytes)");
});

test("an unreadable Windows reading falls back to os.freemem()", () => {
  for (const windowsAvailable of ["", "\r\n", "Get-CimInstance : Invalid class", "-5", "12.5"]) {
    const memory = availableMemory({ platform: "win32", windowsAvailable, freemem: 2 * GIB, now: 0 });
    assert.equal(memory.bytes, 2 * GIB, JSON.stringify(windowsAvailable));
    assert.equal(memory.measure, "os.freemem");
  }
});

test("the Windows gate refreshes Available Bytes once, reuses it for a minute, and drops a stale or failed reading", async () => {
  let clock = 5_000_000, queries = 0;
  const now = () => clock;
  const answer = () => { queries += 1; return `${15 * GIB}\r\n`; };
  const probe = () => ({ platform: "win32", freemem: 389 * MIB, now: clock });
  const [first, second] = await Promise.all([
    measureAvailableMemory(probe(), { query: answer, now }),
    measureAvailableMemory(probe(), { query: answer, now }),
  ]);
  assert.equal(queries, 1, "concurrent gates share one PowerShell query");
  assert.deepEqual(first, { bytes: 15 * GIB, measure: "AvailableBytes" });
  assert.deepEqual(second, { bytes: 15 * GIB, measure: "AvailableBytes" });
  clock += 59_000;
  assert.deepEqual(await measureAvailableMemory(probe(), { query: answer, now }), { bytes: 15 * GIB, measure: "AvailableBytes" });
  assert.equal(queries, 1, "a reading under a minute old is reused");
  assert.deepEqual(availableMemory({ ...probe(), now: clock + 2_000 }), { bytes: 389 * MIB, measure: "os.freemem" }, "a gate never trusts a reading over a minute old");
  clock += 2_000;
  let failures = 0;
  const fail = () => { queries += 1; failures += 1; throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }); };
  assert.deepEqual(await measureAvailableMemory(probe(), { query: fail, now }), { bytes: 389 * MIB, measure: "os.freemem" });
  clock += 30_000;
  assert.deepEqual(await measureAvailableMemory(probe(), { query: fail, now }), { bytes: 389 * MIB, measure: "os.freemem" });
  assert.equal(failures, 1, "a failed read is not retried within the minute either");
  assert.equal(queries, 2);
});

test("a pending update's 30-second health poll starts PowerShell at most once every 5 minutes", async () => {
  assert.equal(HEALTH_MEMORY_MAX_AGE_MS, 5 * 60_000);
  let clock = 90_000_000, queries = 0;
  const now = () => clock;
  const query = () => { queries += 1; return `${15 * GIB}`; };
  const seen = [];
  for (let tick = 0; tick < 40; tick += 1) { // 20 minutes of auto-apply ticks
    const memory = await measureAvailableMemory({ platform: "win32", freemem: 389 * MIB, now: clock, maxAgeMs: HEALTH_MEMORY_MAX_AGE_MS }, { query, now });
    seen.push(memory.measure);
    clock += 30_000;
  }
  assert.equal(queries, 4, "one query per 5 minutes over 20 minutes");
  assert.deepEqual([...new Set(seen)], ["AvailableBytes"], "every tick still sees the available reading");
});

test("Linux and macOS never run the Windows query and keep their own measures", async () => {
  const query = () => { throw new Error("the Windows query must not run"); };
  const linux = await measureAvailableMemory({ platform: "linux", meminfo: linuxMeminfo, freemem: 1, windowsAvailable: "1" }, { query });
  assert.deepEqual(linux, { bytes: 8388608 * 1024, measure: "MemAvailable" });
  const darwin = await measureAvailableMemory({ platform: "darwin", vmStat: macReport, freemem: 1, windowsAvailable: "1" }, { query });
  assert.deepEqual(darwin, { bytes: (5120 + 371200 + 32768) * PAGE, measure: "vm_stat" });
});

test("the Windows query is a hidden, time-limited PowerShell run that never blocks the main process", () => {
  const source = readFileSync(new URL("../../engine/scripts/lib/available-memory.mjs", import.meta.url), "utf8");
  assert.match(source, /execFile\(\s*"powershell\.exe"/u);
  assert.doesNotMatch(source, /execFileSync\(\s*"powershell/u);
  assert.match(source, /Win32_PerfRawData_PerfOS_Memory\)\.AvailableBytes/u);
  assert.match(source, /windowsHide: true, timeout: WINDOWS_AVAILABLE_TIMEOUT_MS/u);
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
  assert.doesNotMatch(main, /[^.\w]availableMemory\(/u, "every gate refreshes the Windows reading first");
  assert.equal(main.match(/await measureAvailableMemory\(\)/gu)?.length, 3, "candidate and standby gates use the 1-minute age");
  assert.match(main, /health: async \(\) => readUpdateHealth\(cfg\.dataDir, \(await measureAvailableMemory\(\{ maxAgeMs: HEALTH_MEMORY_MAX_AGE_MS \}\)\)\.bytes, totalmem\(\)\)/u);
  assert.match(main, /candidateMinFreeBytes\(\)/);
  assert.match(main, /candidateCheckSkippedLine\(available, measure\)/);
});
