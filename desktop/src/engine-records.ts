// Records are recovery hints, not authority to kill a PID. PIDs and ephemeral ports can both be reused.
import { execFile, execFileSync, type ChildProcess } from "node:child_process";
import { readFileSync, readlinkSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";
import { promisify } from "node:util";

export type EngineRole = "engine" | "standby" | "candidate";
export interface EngineRecord { pid: number; port: number; role: EngineRole; spawnedAt?: number; started?: string; executable: string }
type ProcessIdentity = { started: string; executable: string };
const recordsFile = (dataDir: string): string => join(dataDir, "gateway-engines.json");
const run = (file: string, args: string[]): string => execFileSync(file, args, { encoding: "utf8", windowsHide: true, timeout: 5_000, stdio: "pipe" }).trim();
const runAsync = async (file: string, args: string[], timeout = 5_000): Promise<string> =>
  (await promisify(execFile)(file, args, { encoding: "utf8", windowsHide: true, timeout })).stdout.trim();
const START_TOLERANCE_MS = 5_000;

function startedNearSpawn(started: string, spawnedAt: number): boolean {
  try {
    let startedAt: number;
    if (process.platform === "linux") {
      const boot = readFileSync("/proc/stat", "utf8").match(/^btime (\d+)$/m)?.[1];
      const ticksPerSecond = Number(run("getconf", ["CLK_TCK"]));
      if (!boot || !Number.isFinite(ticksPerSecond) || ticksPerSecond <= 0) return false;
      startedAt = Number(boot) * 1_000 + Number(started) * 1_000 / ticksPerSecond;
    } else {
      startedAt = Date.parse(started);
    }
    return Number.isFinite(startedAt) && Math.abs(startedAt - spawnedAt) <= START_TOLERANCE_MS;
  } catch { return false; }
}

function identityMatches(record: EngineRecord, actual: ProcessIdentity): boolean {
  return actual.executable === record.executable &&
    (record.started === undefined || actual.started === record.started) &&
    (record.spawnedAt === undefined ? record.started !== undefined : startedNearSpawn(actual.started, record.spawnedAt));
}

/** An unverifiable identity never authorizes a kill. */
export async function engineProcessIdentity(pid: number): Promise<ProcessIdentity | undefined> {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (!fields[19]) return undefined;
      return { started: fields[19], executable: normalize(readlinkSync(`/proc/${pid}/exe`)) };
    }
    if (process.platform === "win32") {
      const script = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if($p){[pscustomobject]@{started=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath}|ConvertTo-Json -Compress}`;
      const value = JSON.parse(await runAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script])) as { started?: string; executable?: string };
      if (value.started && value.executable) return { started: value.started, executable: normalize(value.executable).toLowerCase() };
      return undefined;
    }
    if (process.platform === "darwin") {
      const started = run("ps", ["-p", String(pid), "-o", "lstart="]);
      const executable = run("lsof", ["-a", "-p", String(pid), "-d", "txt", "-Fn"]).split("\n").find(line => line.startsWith("n/"))?.slice(1);
      return started && executable ? { started, executable: normalize(executable) } : undefined;
    }
  } catch { /* process exited or OS query unavailable */ }
  return undefined;
}

async function ownsListener(pid: number, port: number): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      const script = `$c=Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq ${pid} -and ($_.LocalAddress -eq '127.0.0.1' -or $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::') }; if($c){'owned'}`;
      return await runAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]) === "owned";
    }
    if (process.platform === "darwin") {
      return run("lsof", ["-nP", "-a", "-p", String(pid), `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]).split("\n").includes(String(pid));
    }
    if (process.platform === "linux") {
      const sockets = new Set<string>();
      for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
        for (const line of readFileSync(file, "utf8").split("\n").slice(1)) {
          const fields = line.trim().split(/\s+/);
          if (Number.parseInt(fields[1]?.split(":")[1] ?? "", 16) === port && fields[3] === "0A" && fields[9]) sockets.add(fields[9]);
        }
      }
      for (const fd of readdirSync(`/proc/${pid}/fd`)) {
        try { if (sockets.has(readlinkSync(`/proc/${pid}/fd/${fd}`).match(/^socket:\[(\d+)\]$/)?.[1] ?? "")) return true; }
        catch { /* fd closed during inspection */ }
      }
    }
  } catch { /* cannot prove ownership */ }
  return false;
}

export function readEngineRecords(dataDir: string): EngineRecord[] {
  try {
    const value = JSON.parse(readFileSync(recordsFile(dataDir), "utf8")) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is EngineRecord => Number.isInteger(item?.pid) && item.pid > 0 &&
      Number.isInteger(item?.port) && item.port > 0 && item.port < 65536 && typeof item?.role === "string" &&
      (item?.spawnedAt === undefined || Number.isSafeInteger(item.spawnedAt) && item.spawnedAt > 0) &&
      (item?.started === undefined || typeof item.started === "string" && !!item.started) &&
      typeof item?.executable === "string" && !!item.executable);
  } catch { return []; }
}

function writeEngineRecords(dataDir: string, records: EngineRecord[]): void {
  const file = recordsFile(dataDir);
  try { writeFileSync(`${file}.tmp`, JSON.stringify(records)); renameSync(`${file}.tmp`, file); }
  catch { /* best effort */ }
}
let recordGeneration = 0;
export function clearEngineRecords(dataDir: string): void { recordGeneration++; writeEngineRecords(dataDir, []); }

export function recordEngine(dataDir: string, child: ChildProcess, port: number, role: EngineRole, executable: string): void {
  const pid = child.pid;
  if (pid === undefined) return;
  const generation = recordGeneration;
  const record: EngineRecord = { pid, port, role, spawnedAt: Date.now(), executable: process.platform === "win32" ? normalize(executable).toLowerCase() : normalize(executable) };
  const live = readEngineRecords(dataDir).filter(previous => previous.pid !== pid);
  writeEngineRecords(dataDir, [...live, record]);
  void (async () => {
    const identity = await engineProcessIdentity(pid);
    if (!identity || generation !== recordGeneration) return;
    // An exited child or reused PID must not turn a provisional record into a verified identity.
    if (!identityMatches(record, identity)) return;
    const current = readEngineRecords(dataDir);
    if (current.some(previous => previous.pid === pid && previous.port === port && previous.role === role && previous.spawnedAt === record.spawnedAt && previous.executable === record.executable))
      writeEngineRecords(dataDir, current.map(previous => previous.pid === pid && previous.port === port && previous.role === role && previous.spawnedAt === record.spawnedAt && previous.executable === record.executable
        ? { ...previous, started: identity.started } : previous));
  })().catch(() => { /* recovery hint is best effort */ });
}
async function matches(record: EngineRecord): Promise<boolean> {
  const actual = await engineProcessIdentity(record.pid);
  return actual !== undefined && identityMatches(record, actual);
}
const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** One Windows process and listener snapshot for every recorded engine, not a PowerShell launch per PID. */
async function windowsSnapshot(records: EngineRecord[]): Promise<Map<number, { started: string; executable: string; ports: number[] }>> {
  const pids = [...new Set(records.map(record => record.pid))];
  const ports = [...new Set(records.map(record => record.port))];
  if (!pids.length) return new Map();
  const filter = pids.map(pid => `ProcessId=${pid}`).join(" OR ");
  const script = `$processes=@(Get-CimInstance Win32_Process -Filter '${filter}' -ErrorAction SilentlyContinue);` +
    `$listeners=@(Get-NetTCPConnection -State Listen -LocalPort ${ports.join(",")} -ErrorAction SilentlyContinue | Where-Object { $_.LocalAddress -in '127.0.0.1','0.0.0.0','::' });` +
    `$processes | ForEach-Object { $p=$_; [pscustomobject]@{pid=$p.ProcessId;started=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath;ports=@($listeners | Where-Object { $_.OwningProcess -eq $p.ProcessId } | ForEach-Object { $_.LocalPort })} } | ConvertTo-Json -Compress`;
  try {
    // A cold Get-NetTCPConnection/CIM probe can exceed the per-PID identity-query budget on Windows CI.
    const output = await runAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 20_000);
    const rows = output ? JSON.parse(output) as unknown : [];
    const result = new Map<number, { started: string; executable: string; ports: number[] }>();
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      const item = row as { pid?: number; started?: string; executable?: string; ports?: number[] };
      if (Number.isInteger(item.pid) && item.started && item.executable && Array.isArray(item.ports))
        result.set(item.pid!, { started: item.started, executable: normalize(item.executable).toLowerCase(), ports: item.ports });
    }
    return result;
  } catch { return new Map(); }
}

function snapshotMatches(record: EngineRecord, snapshot: Map<number, { started: string; executable: string; ports: number[] }>): boolean {
  const actual = snapshot.get(record.pid);
  return actual !== undefined && identityMatches(record, actual) && actual.ports.includes(record.port);
}

/** Records that stay after a retire: the attached engine's own record, if the caller kept one. */
function forgetRetired(dataDir: string, keepPid: number | undefined): void {
  if (keepPid === undefined) clearEngineRecords(dataDir);
  else writeEngineRecords(dataDir, readEngineRecords(dataDir).filter(record => record.pid === keepPid));
}

/**
 * Engines from the last session are retired, except `keepPid`: the engine the desktop attached to.
 */
export async function retireRecordedEngines(dataDir: string, log: (line: string) => void, keepPid?: number): Promise<void> {
  if (process.platform === "win32") {
    const records = readEngineRecords(dataDir).filter(record => record.pid !== process.pid && record.pid !== keepPid);
    const snapshot = await windowsSnapshot(records);
    const victims = records.filter(record => snapshotMatches(record, snapshot));
    for (const record of victims) {
      log(`retiring the last session's ${record.role} engine ${record.pid} on port ${record.port}`);
      try { run("taskkill", ["/PID", String(record.pid), "/T"]); } catch { /* process may have exited */ }
    }
    if (victims.length) {
      await pause(1_500);
      const survivors = await windowsSnapshot(victims);
      for (const record of victims) if (snapshotMatches(record, survivors)) {
        try { run("taskkill", ["/PID", String(record.pid), "/T", "/F"]); } catch { /* process may have exited */ }
      }
    }
    forgetRetired(dataDir, keepPid);
    return;
  }
  for (const record of readEngineRecords(dataDir)) {
    if (record.pid === process.pid || record.pid === keepPid || !await matches(record) || !await ownsListener(record.pid, record.port)) continue;
    log(`retiring the last session's ${record.role} engine ${record.pid} on port ${record.port}`);
    try {
      process.kill(-record.pid, "SIGTERM");
    } catch { /* process may have exited */ }
    const graceEnds = Date.now() + 5_000;
    while (Date.now() < graceEnds && await matches(record)) await pause(100);
    if (await matches(record) && await ownsListener(record.pid, record.port)) {
      try {
        process.kill(-record.pid, "SIGKILL");
      } catch { /* process may have exited */ }
    }
  }
  forgetRetired(dataDir, keepPid);
}

/**
 * A recorded engine that is still the same process, owns `port` and answers /readyz: the desktop attaches to it
 * instead of starting a second engine on the port. Records alone never authorize attaching.
 */
export async function findSurvivingEngine(dataDir: string, port: number): Promise<EngineRecord | undefined> {
  const records = readEngineRecords(dataDir).filter(record => record.role === "engine" && record.port === port && record.pid !== process.pid);
  if (!records.length) return undefined;
  const snapshot = process.platform === "win32" ? await windowsSnapshot(records) : undefined;
  for (const record of records) {
    const verified = snapshot ? snapshotMatches(record, snapshot) : await matches(record) && await ownsListener(record.pid, record.port);
    if (verified && await answersReady(port)) return record;
  }
  return undefined;
}

async function answersReady(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/readyz`, { signal: AbortSignal.timeout(2_000) });
    await response.body?.cancel();
    return response.status === 200;
  } catch { return false; }
}
