import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { DesktopConfig } from "./config";
import { extractComponentArchive } from "./component-update-archive";
import { downloadComponent, move, replaceFile } from "./component-update-files";
import { parseComponentRelease, RELEASE_MANIFEST_URL, trustedDownloadResponse, type ComponentRelease } from "./component-update-manifest";
import { stageDesktopUpdate, stagedDesktopVersion, type DesktopInstall } from "./desktop-update";

export interface RefreshOptions {
  retryRejected?: boolean;
  /** The packaged desktop app to update as well; absent in development runs. */
  desktop?: DesktopInstall;
}

interface ReleaseIdentity { version: string; engineSha256: string; windowSha256: string }
interface RejectedRelease extends ReleaseIdentity { reason?: "exit" | "timeout"; timeoutAttempts?: number }
interface Publication {
  version: string;
  identity?: ReleaseIdentity;
  phase: "prepared" | "pending";
  enginePrevious: string;
  engineNext: string;
  windowPrevious: string;
  windowExisted: boolean;
}
const journalFile = (cfg: DesktopConfig): string => join(cfg.dataDir, "component-update-pending.json");
const versionFile = (cfg: DesktopConfig): string => join(cfg.dataDir, "component-update-version.txt");
const rejectedFile = (cfg: DesktopConfig): string => join(cfg.dataDir, "component-update-rejected.json");
const releaseIdentity = (release: ComponentRelease): ReleaseIdentity => ({ version: release.version,
  engineSha256: release.components.engine.sha256, windowSha256: release.components.window.sha256 });
const sameIdentity = (a: ReleaseIdentity | undefined, b: ReleaseIdentity): boolean =>
  a?.version === b.version && a.engineSha256 === b.engineSha256 && a.windowSha256 === b.windowSha256;
async function readOrEmpty(file: string): Promise<string> {
  try { return (await readFile(file, "utf8")).trim(); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
async function publication(cfg: DesktopConfig): Promise<Publication | undefined> {
  const value = await readOrEmpty(journalFile(cfg));
  return value ? JSON.parse(value) as Publication : undefined;
}

export async function componentReleaseRejected(cfg: DesktopConfig, release: ComponentRelease): Promise<boolean> {
  const rejected = await readOrEmpty(rejectedFile(cfg));
  if (!rejected) return false;
  const record = JSON.parse(rejected) as RejectedRelease;
  return sameIdentity(record, releaseIdentity(release)) &&
    (record.reason !== "timeout" || (record.timeoutAttempts ?? 1) >= 2);
}

/** Call only after the selected new engine fails its readiness probe, never for staging/network recovery. */
export async function rejectFailedComponentUpdate(cfg: DesktopConfig, engineDir: string, reason: "exit" | "timeout" = "exit"): Promise<void> {
  const pending = await publication(cfg);
  if (pending?.phase !== "pending" || !pending.identity || pending.engineNext !== engineDir) return;
  if (await readOrEmpty(join(cfg.dataDir, "engine-current.txt")) !== engineDir) return;
  const previous = await readOrEmpty(rejectedFile(cfg));
  const prior = previous ? JSON.parse(previous) as RejectedRelease : undefined;
  const timeoutAttempts = reason === "timeout"
    ? sameIdentity(prior, pending.identity) && prior?.reason === "timeout"
      ? (prior.timeoutAttempts ?? 1) + 1 : 1
    : undefined;
  await replaceFile(rejectedFile(cfg), JSON.stringify({ ...pending.identity, reason, ...(timeoutAttempts ? { timeoutAttempts } : {}) }));
}

export async function rollbackComponentUpdate(cfg: DesktopConfig): Promise<boolean> {
  const pending = await publication(cfg);
  if (!pending) return false;
  const pointer = join(cfg.dataDir, "engine-current.txt");
  const current = await readOrEmpty(pointer);
  if (current !== pending.engineNext && current !== pending.enginePrevious) throw new Error("Engine publication changed outside this update; retain rollback journal");
  if (pending.enginePrevious) await replaceFile(pointer, `${pending.enginePrevious}\n`);
  else await rm(pointer, { force: true });
  if (existsSync(pending.windowPrevious)) {
    if (existsSync(cfg.windowDir)) await move(cfg.windowDir, `${pending.engineNext}-failed-window`);
    await move(pending.windowPrevious, cfg.windowDir);
  } else if (!pending.windowExisted && existsSync(cfg.windowDir)) {
    await move(cfg.windowDir, `${pending.engineNext}-failed-window`);
  }
  await rm(journalFile(cfg));
  return true;
}

/** Call only after the newly selected engine actually reaches readyz. Old component folders remain available. */
export async function confirmComponentUpdate(cfg: DesktopConfig): Promise<void> {
  const pending = await publication(cfg);
  if (!pending || pending.phase !== "pending") return;
  if (await readOrEmpty(join(cfg.dataDir, "engine-current.txt")) !== pending.engineNext) throw new Error("Engine publication changed before update confirmation");
  await replaceFile(versionFile(cfg), `${pending.version}\n`);
  await rm(journalFile(cfg));
}

export async function recoverComponentUpdate(cfg: DesktopConfig): Promise<void> {
  if ((await publication(cfg))?.phase === "prepared") await rollbackComponentUpdate(cfg);
}

export async function readComponentManifest(request: typeof fetch = fetch): Promise<ComponentRelease> {
  const response = await request(RELEASE_MANIFEST_URL, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  trustedDownloadResponse(response);
  let body = "";
  for await (const chunk of response.body!) {
    body += new TextDecoder().decode(chunk);
    if (body.length > 1_048_576) throw new Error("Release manifest is too large");
  }
  return parseComponentRelease(JSON.parse(body));
}

async function stage(cfg: DesktopConfig, release: ComponentRelease, request: typeof fetch): Promise<{ engine: string; window: string }> {
  const updates = join(cfg.dataDir, "updates");
  await mkdir(updates, { recursive: true });
  const directory = await mkdtemp(join(updates, `release-${release.version}-`));
  try {
    for (const name of ["engine", "window"] as const) {
      const archive = join(directory, `${name}.tar.gz`);
      const destination = join(directory, name);
      await downloadComponent(release.components[name], archive, request);
      await mkdir(destination);
      await extractComponentArchive(archive, destination, release.components[name].expandedBytes);
      await rm(archive);
    }
    for (const file of ["engine/branch.mjs", "engine/dist/build-info.json", "window/index.html"]) {
      if (!(await stat(join(directory, file))).isFile()) throw new Error(`Incomplete release: ${file}`);
    }
    await replaceFile(join(directory, "window", "branch-build.txt"), `${release.version}\n`);
    return { engine: join(directory, "engine"), window: join(directory, "window") };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

async function publish(cfg: DesktopConfig, release: ComponentRelease, next: { engine: string; window: string }): Promise<void> {
  const pending: Publication = { version: release.version, identity: releaseIdentity(release), phase: "prepared",
    enginePrevious: await readOrEmpty(join(cfg.dataDir, "engine-current.txt")), engineNext: next.engine,
    windowPrevious: `${next.engine}-previous-window`, windowExisted: existsSync(cfg.windowDir) };
  await replaceFile(journalFile(cfg), JSON.stringify(pending));
  try {
    if (pending.windowExisted) await move(cfg.windowDir, pending.windowPrevious);
    await mkdir(resolve(cfg.windowDir, ".."), { recursive: true });
    await move(next.window, cfg.windowDir);
    await replaceFile(join(cfg.dataDir, "engine-current.txt"), `${next.engine}\n`);
    pending.phase = "pending";
    await replaceFile(journalFile(cfg), JSON.stringify(pending));
  } catch (error) { await rollbackComponentUpdate(cfg); throw error; }
}

/**
 * Does not stop/restart the running engine. The desktop owns activation after staging.
 * An unfinished or held engine/window publication blocks the desktop component too.
 */
async function refresh(cfg: DesktopConfig, request: typeof fetch, options: RefreshOptions): Promise<boolean> {
  await recoverComponentUpdate(cfg);
  if (await publication(cfg)) return false;
  const release = await readComponentManifest(request);
  let staged = false;
  if (await readOrEmpty(versionFile(cfg)) !== release.version && (options.retryRejected || !await componentReleaseRejected(cfg, release))) {
    const next = await stage(cfg, release, request);
    await publish(cfg, release, next);
    staged = true;
  }
  return await stageDesktopUpdate(cfg, release, request, options.desktop) || staged;
}

const refreshes = new WeakMap<DesktopConfig, Promise<boolean>>();
export const COMPONENT_UPDATE_CHECK_MS = 10 * 60 * 1000;
/** Startup, periodic and manual staging share one publication owner. */
export function refreshComponentUpdate(cfg: DesktopConfig, request: typeof fetch = fetch, options: RefreshOptions = {}): Promise<boolean> {
  const active = refreshes.get(cfg);
  if (active) return active;
  const next = refresh(cfg, request, options).finally(() => refreshes.delete(cfg));
  refreshes.set(cfg, next);
  return next;
}

export async function readComponentUpdateStatus(cfg: DesktopConfig): Promise<{ currentVersion: string | null; pendingVersion: string | null; publicationInProgress: boolean }> {
  const pending = await publication(cfg);
  const pendingVersion = pending?.phase === "pending" ? pending.version : await stagedDesktopVersion(cfg);
  return { currentVersion: await readOrEmpty(versionFile(cfg)) || null, pendingVersion, publicationInProgress: Boolean(pending) };
}

export function watchComponentUpdates(cfg: DesktopConfig, log: (line: string) => void, options: RefreshOptions & { onStaged?: () => void } = {}): () => void {
  let busy = false;
  let stopped = false;
  const tick = async (): Promise<void> => {
    if (busy || stopped) return;
    busy = true;
    try {
      if (await refreshComponentUpdate(cfg, fetch, options)) {
        log("Verified GitHub component update staged");
        options.onStaged?.();
      }
    }
    catch (error) { log(`Component update check: ${error instanceof Error ? error.message : String(error)}`); }
    finally { busy = false; }
  };
  void tick();
  const timer = setInterval(() => void tick(), COMPONENT_UPDATE_CHECK_MS);
  return () => { stopped = true; clearInterval(timer); };
}
