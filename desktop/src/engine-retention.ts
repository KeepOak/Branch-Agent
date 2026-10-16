// After an update the previous engine stays only while the new one is on probation. Once the new engine has
// answered /readyz and stayed the running engine for PREVIOUS_ENGINE_HEALTHY_MS, the rollback copy is removed.
// A failed new engine during that window keeps the previous copy, so rollback still works.
import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { DesktopConfig } from "./config";

/** How long a newly confirmed engine must run healthy before its predecessor is removed. One named window. */
export const PREVIOUS_ENGINE_HEALTHY_MS = 24 * 60 * 60 * 1000;

const healthyFile = (cfg: DesktopConfig): string => join(cfg.dataDir, "engine-retention-healthy.json");
const previousFile = (cfg: DesktopConfig): string => join(cfg.dataDir, "component-update-previous.txt");
const journalFile = (cfg: DesktopConfig): string => join(cfg.dataDir, "component-update-pending.json");

interface HealthyEngine { engine: string; healthyAt: number }

async function readOrEmpty(file: string): Promise<string> {
  try { return (await readFile(file, "utf8")).trim(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

async function replaceJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, file);
}

async function samePath(a: string, b: string): Promise<boolean> {
  if (!a || !b) return false;
  if (a === b) return true;
  try { return await realpath(a) === await realpath(b); }
  catch { return false; }
}

/** The release folder that owns this engine, when it is an updater-owned updates/release-<id>/engine. */
function releaseFolder(cfg: DesktopConfig, engine: string): string {
  const parent = dirname(engine);
  return basename(engine) === "engine" && dirname(parent) === join(cfg.dataDir, "updates") ? parent : engine;
}

/**
 * Remember the first /readyz of this published engine. A different engine starts a new window. The existing
 * health signal is the same one boot already uses: the engine answered ready and is the one that serves.
 */
export async function recordHealthyEngineLaunch(cfg: DesktopConfig, engine: string, now = Date.now()): Promise<void> {
  if (!engine) return;
  const raw = await readOrEmpty(healthyFile(cfg));
  if (raw) {
    try {
      const prior = JSON.parse(raw) as Partial<HealthyEngine>;
      if (prior.engine === engine && Number.isFinite(prior.healthyAt)) return;
    } catch { /* replace a damaged record */ }
  }
  await replaceJson(healthyFile(cfg), { engine, healthyAt: now } satisfies HealthyEngine);
}

/**
 * Removes the previous (rollback) engine after the current one has run healthy for the probation window.
 * Does nothing during the window, while an update is in flight, or when that folder is the running engine.
 */
export async function prunePreviousEngineAfterHealth(cfg: DesktopConfig, log: (line: string) => void, now = Date.now()): Promise<boolean> {
  try {
    if (await readOrEmpty(journalFile(cfg))) return false;
    const current = await readOrEmpty(join(cfg.dataDir, "engine-current.txt")) || cfg.engineDir;
    const running = await readOrEmpty(join(cfg.dataDir, "engine-running.txt"));
    const previous = await readOrEmpty(previousFile(cfg));
    if (!previous || !existsSync(previous)) return false;
    if (await samePath(previous, current) || await samePath(previous, running) || await samePath(previous, cfg.engineDir)) {
      return false;
    }
    const raw = await readOrEmpty(healthyFile(cfg));
    if (!raw) return false;
    let healthy: HealthyEngine;
    try { healthy = JSON.parse(raw) as HealthyEngine; } catch { return false; }
    if (typeof healthy.engine !== "string" || !Number.isFinite(healthy.healthyAt)) return false;
    if (healthy.healthyAt > now || now - healthy.healthyAt < PREVIOUS_ENGINE_HEALTHY_MS) return false;
    if (!await samePath(healthy.engine, current)) return false;
    // Still the engine that serves: a failure during probation keeps the rollback copy.
    if (running && !await samePath(running, current)) return false;
    const folder = releaseFolder(cfg, previous);
    if (running && (await samePath(folder, running) || await samePath(folder, dirname(running)))) return false;
    log("Update cleanup: the new engine has run healthy; removing the previous rollback copy");
    await rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    return true;
  } catch (error) {
    log(`Update cleanup: ${String(error)}`);
    return false;
  }
}
