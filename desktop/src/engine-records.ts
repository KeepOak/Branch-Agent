// Records are recovery hints, not authority to kill a PID. PIDs and ephemeral ports can both be reused.
import { execFileSync, type ChildProcess } from "node:child_process";
import { readFileSync, readlinkSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join, normalize } from "node:path";

export type EngineRole = "engine" | "standby" | "candidate";
export interface EngineRecord { pid: number; port: number; role: EngineRole; started: string; executable: string }
const recordsFile = (dataDir: string): string => join(dataDir, "gateway-engines.json");
const run = (file: string, args: string[]): string => execFileSync(file, args, { encoding: "utf8", windowsHide: true, timeout: 5_000, stdio: "pipe" }).trim();

/** An unverifiable identity never authorizes a kill. */
export function engineProcessIdentity(pid: number): Pick<EngineRecord, "started" | "executable"> | undefined {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (!fields[19]) return undefined;
      return { started: fields[19], executable: normalize(readlinkSync(`/proc/${pid}/exe`)) };
    }
    if (process.platform === "win32") {
      const script = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if($p){[pscustomobject]@{started=$p.CreationDate.ToUniversalTime().ToString('o');executable=$p.ExecutablePath}|ConvertTo-Json -Compress}`;
      const value = JSON.parse(run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script])) as { started?: string; executable?: string };
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

function ownsListener(pid: number, port: number): boolean {
  try {
    if (process.platform === "win32") {
      const script = `$c=Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -eq ${pid} -and ($_.LocalAddress -eq '127.0.0.1' -or $_.LocalAddress -eq '0.0.0.0' -or $_.LocalAddress -eq '::') }; if($c){'owned'}`;
      return run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]) === "owned";
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
      typeof item?.started === "string" && !!item.started && typeof item?.executable === "string" && !!item.executable);
  } catch { return []; }
}

function writeEngineRecords(dataDir: string, records: EngineRecord[]): void {
  const file = recordsFile(dataDir);
  try { writeFileSync(`${file}.tmp`, JSON.stringify(records)); renameSync(`${file}.tmp`, file); }
  catch { /* best effort */ }
}
export function clearEngineRecords(dataDir: string): void { writeEngineRecords(dataDir, []); }

export function recordEngine(dataDir: string, child: ChildProcess, port: number, role: EngineRole): void {
  const pid = child.pid;
  if (pid === undefined) return;
  const identity = engineProcessIdentity(pid);
  if (!identity) return;
  const live = readEngineRecords(dataDir).filter(record => record.pid !== pid && matches(record));
  writeEngineRecords(dataDir, [...live, { pid, port, role, ...identity }]);
}
function matches(record: EngineRecord): boolean {
  const actual = engineProcessIdentity(record.pid);
  return actual?.started === record.started && actual.executable === record.executable;
}
const pause = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export async function retireRecordedEngines(dataDir: string, log: (line: string) => void): Promise<void> {
  for (const record of readEngineRecords(dataDir)) {
    if (record.pid === process.pid || !matches(record) || !ownsListener(record.pid, record.port)) continue;
    log(`retiring the last session's ${record.role} engine ${record.pid} on port ${record.port}`);
    try {
      if (process.platform === "win32") run("taskkill", ["/PID", String(record.pid), "/T"]);
      else process.kill(-record.pid, "SIGTERM");
    } catch { /* process may have exited */ }
    const graceEnds = Date.now() + (process.platform === "win32" ? 1_500 : 5_000);
    while (Date.now() < graceEnds && matches(record)) await pause(100);
    if (matches(record) && ownsListener(record.pid, record.port)) {
      try {
        if (process.platform === "win32") run("taskkill", ["/PID", String(record.pid), "/T", "/F"]);
        else process.kill(-record.pid, "SIGKILL");
      } catch { /* process may have exited */ }
    }
  }
  clearEngineRecords(dataDir);
}
