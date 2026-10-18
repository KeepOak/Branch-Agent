import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import type { HomeWidgetCopy } from './homeWidget';

export type HomeWidgetNative = {
  publish: (title: string, detail: string, counts: string, askLabel: string, work: string, action: string) => void;
  takeLaunchAction: () => string | null;
  addListener: (event: 'onLaunchAction', listener: (event: { action: string }) => void) => { remove: () => void };
};

/** AppWidgetProvider lives in the local Expo module. Missing native code is a no-op, not a crash. */
export function loadHomeWidget(): HomeWidgetNative | null {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeModule<HomeWidgetNative>('HomeWidget');
  } catch {
    return null;
  }
}

export function publishHomeWidget(copy: HomeWidgetCopy): void {
  loadHomeWidget()?.publish(copy.title, copy.detail, copy.counts, copy.askLabel, copy.work, copy.action);
}
