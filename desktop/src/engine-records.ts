// Every engine the desktop starts (the serving one, an update's standby, a candidate check) is recorded in
// <data>/gateway-engines.json the moment it is spawned, with its port; records of engines that have exited are
// dropped at the next spawn (never on exit, so a quit never writes into a data folder being removed). A desktop that
// crashed or was killed leaves its engines' records behind, so the next launch can retire exactly those engines
// before it starts its own: never a dead one, and never one whose port is free (a reused PID).
import { execFileSync, type ChildProcess } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

export type EngineRole = "engine" | "standby" | "candidate";
export interface EngineRecord { pid: number; port: number; role: EngineRole }

const recordsFile = (dataDir: string): string => join(dataDir, "gateway-engines.json");

export function readEngineRecords(dataDir: string): EngineRecord[] {
  try {
    const value = JSON.parse(readFileSync(recordsFile(dataDir), "utf8")) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is EngineRecord => Number.isInteger(item?.pid) && item.pid > 0 &&
      Number.isInteger(item?.port) && item.port > 0 && item.port < 65536 && typeof item?.role === "string");
  } catch {
    return [];
  }
}

function writeEngineRecords(dataDir: string, records: EngineRecord[]): void {
  const file = recordsFile(dataDir);
  try { writeFileSync(`${file}.tmp`, JSON.stringify(records)); renameSync(`${file}.tmp`, file); }
  catch { /* best effort: a missing record only means the next launch cannot retire that engine */ }
}

/** Records a just-spawned engine, dropping the records of engines that have exited since. */
export function recordEngine(dataDir: string, child: ChildProcess, port: number, role: EngineRole): void {
  const pid = child.pid;
  if (pid === undefined) return;
  const live = readEngineRecords(dataDir).filter(record => record.pid !== pid && alive(record.pid));
  writeEngineRecords(dataDir, [...live, { pid, port, role }]);
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}
const portInUse = (port: number): Promise<boolean> => new Promise(resolve => {
  const probe = createServer();
  probe.once("error", () => resolve(true));
  probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(false)));
});

/**
 * At launch: stops every recorded engine from the last session that is still alive and still holds its port (an
 * update's stepped-down engine or standby, or a candidate, left by a desktop crash), then clears the records.
 */
export async function retireRecordedEngines(dataDir: string, log: (line: string) => void): Promise<void> {
  const left = readEngineRecords(dataDir).filter(record => record.pid !== process.pid && alive(record.pid));
  for (const record of left) {
    if (!await portInUse(record.port)) continue;
    log(`retiring the last session's ${record.role} engine ${record.pid} on port ${record.port}`);
    try {
      if (process.platform === "win32") execFileSync("taskkill", ["/PID", String(record.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      else process.kill(-record.pid, "SIGKILL");
    } catch { /* already gone */ }
    for (let i = 0; i < 100 && alive(record.pid); i++) await new Promise(resolve => setTimeout(resolve, 100));
  }
  writeEngineRecords(dataDir, []);
}
