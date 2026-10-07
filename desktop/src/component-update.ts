import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { DesktopConfig } from "./config";
import { extractComponentArchive } from "./component-update-archive";
import { downloadComponent, move, replaceFile } from "./component-update-files";
import { parseComponentRelease, RELEASE_MANIFEST_URL, trustedDownloadResponse, type ComponentRelease } from "./component-update-manifest";
import { stageDesktopUpdate, stagedDesktopVersion, type DesktopInstall } from "./desktop-update";

export interface RefreshOptions {
  retryRejected?: boolean;
  /** The packaged desktop app to update as well; absent in development runs. */
  desktop?: DesktopInstall;
  /**
   * Runs `replace` while holding the desktop's swap guard (no update, rollback or window swap can start meanwhile),
   * or resolves undefined when the guard is busy. Given it, a newer release replaces a staged pair the running
   * engine never started, instead of waiting behind it.
   */
  underSwapGuard?: (replace: () => Promise<boolean>) => Promise<boolean | undefined>;
  log?: (line: string) => void;
  /** Clear an offered version as soon as the manifest withdraws it, before Windows folder moves retry. */
  onWithdrawal?: (version: string) => void;
}

interface ReleaseIdentity { version: string; engineSha256: string; windowSha256: string }
interface RejectedRelease extends ReleaseIdentity { reason?: "exit" | "timeout"; timeoutAttempts?: number }
interface TimedOutRelease extends ReleaseIdentity { attempts: number }
interface Publication {
  version: string;
  identity?: ReleaseIdentity;
  phase: "prepared" | "pending";
  enginePrevious: string;
  engineNext: string;
  windowPrevious: string;
  windowExisted: boolean;
  /** While a staged pair is being replaced in place: the staged engine it replaces. */
  engineReplaced?: string;
}
const journalFile = (cfg: DesktopConfig): string => join(cfg.dataDir, "component-update-pending.json");
const versionFile = (cfg: DesktopConfig): string => join(cfg.dataDir, "component-update-version.txt");
const rejectedFile = (cfg: DesktopConfig): string => join(cfg.dataDir, "component-update-rejected.json");
const timeoutFile = (cfg: DesktopConfig): string => join(cfg.dataDir, "component-update-timeouts.json");
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
  return sameIdentity(record, releaseIdentity(release));
}

/** A first timeout is retryable after rollback; a second timeout rejects this exact release. */
export async function recordComponentUpdateTimeout(cfg: DesktopConfig, engineDir: string): Promise<number> {
  const pending = await publication(cfg);
  if (pending?.phase !== "pending" || !pending.identity || pending.engineNext !== engineDir) return 0;
  if (await readOrEmpty(join(cfg.dataDir, "engine-current.txt")) !== engineDir) return 0;
  const raw = await readOrEmpty(timeoutFile(cfg));
  const prior = raw ? JSON.parse(raw) as TimedOutRelease : undefined;
  const attempts = sameIdentity(prior, pending.identity) && Number.isSafeInteger(prior?.attempts) ? prior!.attempts + 1 : 1;
  await replaceFile(timeoutFile(cfg), JSON.stringify({ ...pending.identity, attempts }));
  if (attempts >= 2) await replaceFile(rejectedFile(cfg), JSON.stringify({ ...pending.identity, reason: "timeout", timeoutAttempts: attempts }));
  return attempts;
}

/** Call only after the selected new engine fails its readiness probe, never for staging/network recovery. */
export async function rejectFailedComponentUpdate(cfg: DesktopConfig, engineDir: string): Promise<void> {
  const pending = await publication(cfg);
  if (pending?.phase !== "pending" || !pending.identity || pending.engineNext !== engineDir) return;
  if (await readOrEmpty(join(cfg.dataDir, "engine-current.txt")) !== engineDir) return;
  await replaceFile(rejectedFile(cfg), JSON.stringify({ ...pending.identity, reason: "exit" }));
}

export async function rollbackComponentUpdate(cfg: DesktopConfig, retryServedWindow = false): Promise<boolean> {
  const pending = await publication(cfg);
  if (!pending) return false;
  const pointer = join(cfg.dataDir, "engine-current.txt");
  const current = await readOrEmpty(pointer);
  if (current !== pending.engineNext && current !== pending.enginePrevious && current !== pending.engineReplaced) throw new Error("Engine publication changed outside this update; retain rollback journal");
  const moveWindow = async (source: string, target: string) => {
    for (let attempt = 0;; attempt++) {
      try { await move(source, target); return; }
      catch (error) {
        if (!retryServedWindow || process.platform !== "win32" ||
          !["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "") || attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  };
  if (existsSync(pending.windowPrevious)) {
    const displaced = `${pending.engineNext}-failed-window`;
    const movedServed = existsSync(cfg.windowDir);
    if (movedServed) await moveWindow(cfg.windowDir, displaced);
    try { await moveWindow(pending.windowPrevious, cfg.windowDir); }
    catch (error) {
      if (movedServed) await moveWindow(displaced, cfg.windowDir);
      throw error;
    }
  } else if (!pending.windowExisted && existsSync(cfg.windowDir)) {
    await moveWindow(cfg.windowDir, `${pending.engineNext}-failed-window`);
  }
  if (pending.enginePrevious) await replaceFile(pointer, `${pending.enginePrevious}\n`);
  else await rm(pointer, { force: true });
  await rm(journalFile(cfg));
  return true;
}

const runProcessList = promisify(execFile);

/** Adopt only old, fully published release layouts whose build identity matches the folder. */
async function backfillLegacyReleaseMarker(folder: string, name: string): Promise<boolean> {
  const match = /^release-(.+-build-([a-f0-9]{12}))-[A-Za-z0-9]{6}$/.exec(name);
  if (!match) return false;
  const folderInfo = await stat(folder);
  // A fresh download uses the same name while extraction is in progress.
  if (Date.now() - folderInfo.mtimeMs < 24 * 60 * 60 * 1000) return false;
  try {
    const manifest = JSON.parse(await readFile(join(folder, "engine", "dist", "build-info.json"), "utf8")) as { commit?: unknown; buildId?: unknown };
    if (typeof manifest.commit !== "string" || !/^[a-f0-9]{40}$/.test(manifest.commit)
      || manifest.commit.slice(0, 12) !== match[2]
      || typeof manifest.buildId !== "string" || !manifest.buildId.includes(manifest.commit.slice(0, 12))) return false;
    for (const file of ["engine/branch.mjs", "engine/package.json", "engine/dist/build-info.json"]) {
      if (!(await stat(join(folder, file))).isFile()) return false;
    }
    // Existing folders predate the marker. The manifest's source hash and complete
    // engine layout distinguish them from incomplete downloads before adoption.
    await writeFile(join(folder, ".release-complete"), "");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

/** If inspection fails, keep releases: deleting an active engine is worse than retaining an old one. */
async function runningProcessCommands(): Promise<string> {
  if (process.platform === "linux") {
    const commands: string[] = [];
    for (const entry of await readdir("/proc", { withFileTypes: true })) {
      if (!/^\d+$/.test(entry.name)) continue;
      try {
        commands.push(await readFile(`/proc/${entry.name}/cmdline`, "utf8"));
        commands.push(await readlink(`/proc/${entry.name}/cwd`));
      }
      catch (error) { if (!["ENOENT", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
    }
    return commands.join("\n");
  }
  const command = process.platform === "win32" ? "powershell.exe" : "ps";
  const args = process.platform === "win32"
    ? ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | Select-Object -ExpandProperty CommandLine"]
    : ["-axo", "command="];
  return (await runProcessList(command, args, { encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout;
}

/** Only completed release folders created directly under this data directory are owned by the updater. */
async function pruneConfirmedReleases(cfg: DesktopConfig, current: string, previous: string, reportFailure?: (error: unknown) => void): Promise<void> {
  const updates = join(cfg.dataDir, "updates");
  const running = await readOrEmpty(join(cfg.dataDir, "engine-running.txt"));
  const updatesReal = await realpath(updates);
  const retained = new Set<string>();
  for (const engine of [current, previous, running]) {
    if (!engine || basename(engine) !== "engine") continue;
    try {
      const folder = await realpath(dirname(engine));
      if (dirname(folder) === updatesReal) retained.add(folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const pending = await publication(cfg);
  if (pending) retained.add(await realpath(dirname(pending.engineNext)));
  let commands: string;
  try { commands = await runningProcessCommands(); }
  catch (error) { reportFailure?.(error); return; }
  for (const entry of await readdir(updates, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name.startsWith(".trash-release-")) {
      try { await rm(join(updates, entry.name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
      catch (error) { reportFailure?.(new Error(`Could not finish pruning ${entry.name}: ${String(error)}`)); }
      continue;
    }
    if (!entry.isDirectory() || !/^release-[\w.-]+-[A-Za-z0-9]{6}$/.test(entry.name)
      || /(?:^|[-.])(staging|pending)(?:[-.]|$)/i.test(entry.name)) continue;
    const folder = resolve(updates, entry.name);
    const folderReal = await realpath(folder);
    // A download has the same release-* name until staging completes; never select it for pruning.
    if (!existsSync(join(folder, ".release-complete"))) {
      try { if (!await backfillLegacyReleaseMarker(folder, entry.name)) continue; }
      catch (error) { reportFailure?.(new Error(`Could not verify ${entry.name}: ${String(error)}`)); continue; }
    }
    const separator = process.platform === "win32" ? "\\" : "/";
    const commandsLower = commands.toLowerCase();
    if (retained.has(folderReal) || [folder, folderReal].some(path => commandsLower.includes(`${path}${separator}`.toLowerCase()))) continue;
    const trash = join(updates, `.trash-${entry.name}-${process.pid}-${Math.random().toString(36).slice(2)}`);
    try {
      await rename(folder, trash);
      await rm(trash, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch (error) { reportFailure?.(new Error(`Could not prune ${entry.name}: ${String(error)}`)); }
  }
}

/** Call only after the newly selected engine actually reaches readyz. Keep its predecessor for rollback. */
export async function confirmComponentUpdate(cfg: DesktopConfig, reportPruneFailure?: (error: unknown) => void, deferPrune = false): Promise<(() => Promise<void>) | undefined> {
  const pending = await publication(cfg);
  if (!pending || pending.phase !== "pending") return;
  if (await readOrEmpty(join(cfg.dataDir, "engine-current.txt")) !== pending.engineNext) throw new Error("Engine publication changed before update confirmation");
  await replaceFile(versionFile(cfg), `${pending.version}\n`);
  await rm(journalFile(cfg));
  await rm(timeoutFile(cfg), { force: true });
  // Cleanup is maintenance, not a readiness failure: never roll back a healthy engine because a stale folder is locked.
  const prune = async () => {
    try { await pruneConfirmedReleases(cfg, pending.engineNext, pending.enginePrevious, reportPruneFailure); }
    catch (error) { reportPruneFailure?.(error); }
  };
  if (deferPrune) return prune;
  await prune();
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
    await writeFile(join(dirname(next.engine), ".release-complete"), "");
  } catch (error) { await rollbackComponentUpdate(cfg); throw error; }
}

/** A staged pair the running engine never started: a newer release may replace it. */
async function replaceable(cfg: DesktopConfig, held: Publication): Promise<boolean> {
  return held.phase === "pending" && await readOrEmpty(join(cfg.dataDir, "engine-running.txt")) !== held.engineNext;
}

/** Removes a superseded staged component folder under <data>/updates; a failure is logged, never silent. */
async function removeStagedFolder(cfg: DesktopConfig, folder: string, log?: (line: string) => void): Promise<void> {
  const inside = relative(join(cfg.dataDir, "updates"), folder);
  // relative() returns an absolute path for a folder on another Windows drive.
  if (!inside || inside.startsWith("..") || isAbsolute(inside) || !existsSync(folder)) return;
  try { await rm(folder, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
  catch (error) { log?.(`Superseded staged update folder ${folder} could not be removed: ${error instanceof Error ? error.message : String(error)}`); }
}

/** Test seam: replaces the folder move used by a staged-pair replacement (to fail it part way). */
let replacementMove: typeof move = move;
export function setReplacementMoveForTests(fn: typeof move | undefined): void { replacementMove = fn ?? move; }

/**
 * Replaces a staged, never-started engine/window pair with a newer release in place, under one journal. The running
 * build's window (windowPrevious) never moves, so the window the desktop serves stays valid throughout. A failure
 * part way puts the held staged pair back exactly as it was (only if that fails too does the publication roll back
 * to the running build); a crash in between is rolled back to the running build like any prepared publication.
 * Resolves with the superseded folders, which the caller removes once the swap guard is released.
 */
async function replaceStagedInPlace(cfg: DesktopConfig, held: Publication, release: ComponentRelease, next: { engine: string; window: string }, log?: (line: string) => void): Promise<string[]> {
  const pending: Publication = { ...held, version: release.version, identity: releaseIdentity(release), phase: "prepared",
    engineNext: next.engine, engineReplaced: held.engineNext };
  await replaceFile(journalFile(cfg), JSON.stringify(pending));
  const supersededWindow = `${held.engineNext}-superseded-window`;
  let heldWindowMoved = false, nextWindowMoved = false;
  try {
    if (existsSync(cfg.windowDir)) { await replacementMove(cfg.windowDir, supersededWindow); heldWindowMoved = true; }
    await replacementMove(next.window, cfg.windowDir); nextWindowMoved = true;
    await replaceFile(join(cfg.dataDir, "engine-current.txt"), `${next.engine}\n`);
    pending.phase = "pending";
    delete pending.engineReplaced;
    await replaceFile(journalFile(cfg), JSON.stringify(pending));
  } catch (error) {
    try {
      if (nextWindowMoved && existsSync(cfg.windowDir)) await replacementMove(cfg.windowDir, next.window);
      if (heldWindowMoved) await replacementMove(supersededWindow, cfg.windowDir);
      await replaceFile(join(cfg.dataDir, "engine-current.txt"), `${held.engineNext}\n`);
      await replaceFile(journalFile(cfg), JSON.stringify(held));
      log?.(`The staged update could not be replaced (${error instanceof Error ? error.message : String(error)}); ${held.version} stays staged`);
    } catch (restoreError) {
      log?.(`The staged update could not be put back (${String(restoreError)}); rolling back to the running build`);
      await rollbackComponentUpdate(cfg);
    }
    throw error;
  }
  return [held.engineNext, supersededWindow];
}

/**
 * A newer release replaces a staged, never-started pair. It is downloaded first, with nothing touched; the
 * replacement itself runs under the desktop's swap guard, so no update or window swap can start against it.
 */
async function replaceStaged(cfg: DesktopConfig, held: Publication, release: ComponentRelease, request: typeof fetch, options: RefreshOptions): Promise<"replaced" | "withdrawn" | false> {
  if (!options.underSwapGuard || held.version === release.version) return false;
  // The manifest went back to the version that runs: the staged release was withdrawn. Never stage a copy of the
  // running build as an "update"; put the running build's pair back instead (under the guard, as any replacement).
  if (release.version === await readOrEmpty(versionFile(cfg))) {
    const withdrawn = await options.underSwapGuard(async () => {
      const current = await publication(cfg);
      if (current?.engineNext !== held.engineNext || !await replaceable(cfg, current)) return false;
      options.log?.(`The staged update ${current.version} was withdrawn; the running ${release.version} stays`);
      options.onWithdrawal?.(current.version);
      return rollbackComponentUpdate(cfg, true);
    });
    return withdrawn === true ? "withdrawn" : false;
  }
  if (!options.retryRejected && await componentReleaseRejected(cfg, release)) return false;
  const next = await stage(cfg, release, request);
  let superseded: string[] = [];
  try {
    const replaced = await options.underSwapGuard(async () => {
      // Re-checked under the guard: the staged pair may have been applied or changed while downloading.
      const current = await publication(cfg);
      if (current?.engineNext !== held.engineNext || current.phase !== "pending" || !await replaceable(cfg, current)) return false;
      superseded = await replaceStagedInPlace(cfg, current, release, next, options.log);
      return true;
    });
    if (replaced !== true) superseded = [dirname(next.engine)];
    return replaced === true ? "replaced" : false;
  } catch (error) {
    superseded = [dirname(next.engine)];
    throw error;
  } finally {
    // Outside the guard: removing an engine folder can take seconds on Windows, and crash recovery waits on the guard.
    for (const folder of superseded) await removeStagedFolder(cfg, folder, options.log);
  }
}

/**
 * Does not stop/restart the running engine. The desktop owns activation after staging.
 * An unfinished publication, or a staged one that cannot be replaced, blocks the desktop component too.
 */
async function refresh(cfg: DesktopConfig, request: typeof fetch, options: RefreshOptions): Promise<boolean> {
  await recoverComponentUpdate(cfg);
  const held = await publication(cfg);
  if (held && (!options.underSwapGuard || !await replaceable(cfg, held))) return false;
  const release = await readComponentManifest(request);
  if (held) {
    const result = await replaceStaged(cfg, held, release, request, options);
    if (!result) return false;
    return await stageDesktopUpdate(cfg, release, request, options.desktop) || result === "replaced";
  }
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

export interface ComponentUpdateState {
  currentVersion: string | null;
  /** Any staged update, including a desktop app that waits for the next launch. */
  pendingVersion: string | null;
  /** A staged engine/window pair, which the desktop applies in place without restarting the app. */
  componentsPendingVersion: string | null;
  publicationInProgress: boolean;
  /** The window build the running engine was started with, kept beside the staged one until it is applied. */
  previousWindowDir: string | null;
}

export async function readComponentUpdateStatus(cfg: DesktopConfig): Promise<ComponentUpdateState> {
  const pending = await publication(cfg);
  const componentsPendingVersion = pending?.phase === "pending" ? pending.version : null;
  const previousWindowDir = pending?.phase === "pending" && typeof pending.windowPrevious === "string"
    && existsSync(join(pending.windowPrevious, "index.html")) ? pending.windowPrevious : null;
  return { currentVersion: await readOrEmpty(versionFile(cfg)) || null, pendingVersion: componentsPendingVersion ?? await stagedDesktopVersion(cfg),
    componentsPendingVersion, publicationInProgress: Boolean(pending), previousWindowDir };
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
