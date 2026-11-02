import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { installedAppVersion } from '../build/appIdentity';
import { cacheDir, downloadToFile, readRemoteText } from './download';
import { loadApkInstaller } from './native';
import { createUpdateFlow, type UpdateFlow, type UpdateFlowDeps, type UpdateFlowState } from './updateFlow';

async function deviceDeps(): Promise<UpdateFlowDeps | null> {
  if (Platform.OS !== 'android') return null;
  const native = loadApkInstaller();
  if (!native) return null;
  return {
    local: installedAppVersion(),
    cacheDir: await cacheDir(),
    download: downloadToFile,
    readText: readRemoteText,
    sha256File: (path) => native.sha256File(path),
    installedSigningCerts: () => native.installedSigningCerts(),
    apkSigningCerts: (path) => native.apkSigningCerts(path),
    canInstallPackages: () => native.canInstallPackages(),
    openInstallPermissionSettings: () => native.openInstallPermissionSettings(),
    installApk: (path) => native.installApk(path),
  };
}

const idle: UpdateFlowState = { status: 'idle' };

/** Android-only APK update. iOS, web and tests without native code stay idle. */
export function useApkUpdate(given?: UpdateFlowDeps | null) {
  const [flow, setFlow] = useState<UpdateFlow | null>(null);

  useEffect(() => {
    let live = true;
    const attach = (created: UpdateFlow) => {
      if (!live) return;
      setFlow(created);
      void created.check();
    };
    if (given === undefined) {
      void deviceDeps().then((resolved) => {
        if (resolved) attach(createUpdateFlow(resolved));
      });
    } else if (given) {
      attach(createUpdateFlow(given));
    }
    return () => {
      live = false;
      setFlow(null);
    };
  }, [given]);

  useEffect(() => {
    if (!flow) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void flow.onAppActive();
    });
    return () => sub.remove();
  }, [flow]);

  const state = useSyncExternalStore(
    (listener) => (flow ? flow.subscribe(listener) : () => undefined),
    () => flow?.getState() ?? idle,
    () => idle,
  );

  return {
    state,
    check: () => void flow?.check(),
    startUpdate: () => void flow?.startUpdate(),
    allowInstalls: () => flow?.allowInstalls(),
  };
}
