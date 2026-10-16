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

test("Windows uses available memory, so standby does not skip the candidate check", () => {
  const strictlyFree = 389 * MIB;
  let reads = 0;
  const memory = availableMemory({
    platform: "win32",
    meminfo: linuxMeminfo,
    vmStat: macReport,
    freemem: strictlyFree,
    readWindowsAvailable: () => {
      reads += 1;
      return "15728640\r\n";
    },
  });
  const min = candidateMinFreeBytes({ envMb: undefined, totalmem: 16 * GIB });
  assert.equal(reads, 1);
  assert.equal(memory.bytes, 15 * GIB);
  assert.equal(memory.measure, "available memory");
  assert.ok(strictlyFree < min, "old os.freemem() gate would skip");
  assert.ok(memory.bytes >= min);
});

test("Windows accepts a supplied FreePhysicalMemory reading", () => {
  const memory = availableMemory({ platform: "win32", windowsAvailable: " 204800 ", freemem: 389 * MIB });
  assert.equal(memory.bytes, 200 * MIB);
  assert.equal(memory.measure, "available memory");
  const empty = availableMemory({ platform: "win32", windowsAvailable: "0", freemem: 8 * GIB });
  assert.equal(empty.bytes, 0);
  assert.equal(empty.measure, "available memory");
});

test("a Windows probe without a reader stays on os.freemem()", () => {
  const memory = availableMemory({ platform: "win32", meminfo: linuxMeminfo, vmStat: macReport, freemem: 7 * GIB });
  assert.equal(memory.bytes, 7 * GIB);
  assert.equal(memory.measure, "os.freemem");
});

test("a failed or unreadable Windows reading falls back to os.freemem()", () => {
  const timedOut = availableMemory({
    platform: "win32",
    freemem: 389 * MIB,
    readWindowsAvailable: () => {
      throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    },
  });
  assert.equal(timedOut.bytes, 389 * MIB);
  assert.equal(timedOut.measure, "os.freemem");
  const garbage = availableMemory({ platform: "win32", windowsAvailable: "no counter", freemem: 2 * GIB });
  assert.equal(garbage.bytes, 2 * GIB);
  assert.equal(garbage.measure, "os.freemem");
  const blank = availableMemory({ platform: "win32", windowsAvailable: "\n", freemem: 1 * GIB });
  assert.equal(blank.bytes, 1 * GIB);
  assert.equal(blank.measure, "os.freemem");
});

test("Linux and macOS ignore the Windows available-memory reader", () => {
  const readWindowsAvailable = () => {
    throw new Error("Windows reader must not run");
  };
  const linux = availableMemory({ platform: "linux", meminfo: linuxMeminfo, freemem: 1, readWindowsAvailable });
  assert.equal(linux.bytes, 8388608 * 1024);
  assert.equal(linux.measure, "MemAvailable");
  const darwin = availableMemory({ platform: "darwin", vmStat: macReport, freemem: 1, readWindowsAvailable });
  assert.equal(darwin.bytes, (5120 + 371200 + 32768) * PAGE);
  assert.equal(darwin.measure, "vm_stat");
});

test("the Windows reader is a hidden PowerShell query with a timeout", () => {
  const source = readFileSync(new URL("../../engine/scripts/lib/available-memory.mjs", import.meta.url), "utf8");
  assert.match(source, /powershell\.exe/);
  assert.match(source, /Get-CimInstance Win32_OperatingSystem/);
  assert.match(source, /FreePhysicalMemory/);
  assert.match(source, /windowsHide:\s*true/);
  assert.match(source, /timeout:\s*WINDOWS_AVAILABLE_TIMEOUT_MS/);
  assert.equal(source.includes("WINDOWS_AVAILABLE_TIMEOUT_MS = 3_000"), true);
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
  const windows = availableMemory({ platform: "win32", windowsAvailable: "204800", freemem: 389 * MIB });
  assert.equal(
    candidateCheckSkippedLine(windows.bytes, windows.measure),
    "candidate check skipped; 200 MB available, not enough to start a second engine",
  );
});

test("the candidate and standby gates use reclaimable memory and name the measure", () => {
  const main = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/main.ts"), "utf8");
  assert.doesNotMatch(main, /\bfreemem\b/);
  assert.match(main, /availableMemory\(\{ readWindows: true \}\)/);
  assert.equal(main.match(/availableMemory\(\{ readWindows: true \}\)/g)?.length, 3);
  assert.match(main, /readUpdateHealth\(cfg\.dataDir, availableMemory\(\)\.bytes, totalmem\(\)\)/);
  assert.match(main, /candidateMinFreeBytes\(\)/);
  assert.match(main, /candidateCheckSkippedLine\(available, measure\)/);
  assert.match(main, /candidateCheckSkippedLine\(bytes, measure\)/);
});
