import type { ApkOffer } from './githubRelease';
import { fetchReleases, findNewerApk } from './githubRelease';
import { filePath } from './native';
import { assertCertsMatch, assertChecksum, parseSha256Asset, VerifyError } from './verify';

export const NEEDS_PERMISSION_MESSAGE =
  'Android asks once before Branch can install an update. Allow it for Branch, then this screen comes back and the update continues.';

export type UpdateFlowState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'upToDate' }
  | { status: 'available'; offer: ApkOffer }
  | { status: 'needsPermission'; offer: ApkOffer }
  | { status: 'downloading'; offer: ApkOffer; progress: number }
  | { status: 'verifying'; offer: ApkOffer }
  | { status: 'installing'; offer: ApkOffer }
  | { status: 'error'; message: string; offer?: ApkOffer };

export type UpdateFlowDeps = {
  local: { version: string; versionCode: number };
  cacheDir: string;
  fetchReleases?: () => Promise<import('./githubRelease').GithubRelease[]>;
  download: (url: string, dest: string, onProgress: (progress: number) => void) => Promise<void>;
  readText: (path: string) => Promise<string>;
  sha256File: (path: string) => Promise<string>;
  installedSigningCerts: () => Promise<string[]>;
  apkSigningCerts: (path: string) => Promise<string[]>;
  canInstallPackages: () => boolean;
  openInstallPermissionSettings: () => void;
  installApk: (path: string) => Promise<void>;
};

function apkDest(cacheDir: string): string {
  const root = cacheDir.endsWith('/') ? cacheDir : `${cacheDir}/`;
  return `${root}apk-updates/branch-android-update.apk`;
}

function asError(error: unknown, fallback: string): string {
  if (error instanceof VerifyError) return error.userText;
  return fallback;
}

export function createUpdateFlow(deps: UpdateFlowDeps) {
  let state: UpdateFlowState = { status: 'idle' };
  const listeners = new Set<(state: UpdateFlowState) => void>();
  let generation = 0;

  const set = (next: UpdateFlowState) => {
    state = next;
    for (const listener of [...listeners]) listener(state);
  };

  const getState = () => state;
  const subscribe = (listener: (next: UpdateFlowState) => void) => {
    listeners.add(listener);
    listener(state);
    return () => listeners.delete(listener);
  };

  const check = async () => {
    const mine = ++generation;
    set({ status: 'checking' });
    try {
      const releases = await (deps.fetchReleases ?? (() => fetchReleases()))();
      if (mine !== generation) return;
      const offer = findNewerApk(releases, deps.local);
      set(offer ? { status: 'available', offer } : { status: 'upToDate' });
    } catch (error) {
      if (mine !== generation) return;
      set({ status: 'error', message: asError(error, 'Couldn’t check for an update.') });
    }
  };

  const apply = async (offer: ApkOffer) => {
    const mine = ++generation;
    if (!deps.canInstallPackages()) {
      set({ status: 'needsPermission', offer });
      return;
    }
    const dest = apkDest(deps.cacheDir);
    try {
      set({ status: 'downloading', offer, progress: 0 });
      await deps.download(offer.apk.browser_download_url, dest, (progress) => {
        if (mine !== generation) return;
        set({ status: 'downloading', offer, progress });
      });
      if (mine !== generation) return;
      set({ status: 'verifying', offer });
      const expected = parseSha256Asset(await deps.readText(offer.sha256.browser_download_url));
      const actual = await deps.sha256File(filePath(dest));
      assertChecksum(actual, expected);
      const installed = await deps.installedSigningCerts();
      const apkCerts = await deps.apkSigningCerts(filePath(dest));
      assertCertsMatch(installed, apkCerts);
      if (mine !== generation) return;
      set({ status: 'installing', offer });
      await deps.installApk(filePath(dest));
    } catch (error) {
      if (mine !== generation) return;
      set({
        status: 'error',
        message: asError(error, 'The update couldn’t be installed.'),
        offer,
      });
    }
  };

  const startUpdate = async () => {
    const offer =
      state.status === 'available' ||
      state.status === 'needsPermission' ||
      state.status === 'error'
        ? state.offer
        : undefined;
    if (!offer) return;
    await apply(offer);
  };

  const allowInstalls = () => {
    const offer = state.status === 'needsPermission' ? state.offer : state.status === 'error' ? state.offer : undefined;
    if (!offer) return;
    set({ status: 'needsPermission', offer });
    deps.openInstallPermissionSettings();
  };

  /** After returning from the unknown-apps screen: continue if Android now allows installs. */
  const onAppActive = async () => {
    if (state.status !== 'needsPermission') return;
    if (!deps.canInstallPackages()) return;
    await apply(state.offer);
  };

  return { getState, subscribe, check, startUpdate, allowInstalls, onAppActive };
}

export type UpdateFlow = ReturnType<typeof createUpdateFlow>;
