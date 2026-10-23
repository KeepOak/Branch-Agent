import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type LendServiceNative = {
  start: (title: string, text: string, stopLabel: string) => boolean;
  stop: () => void;
  takeStopRequest: () => boolean;
  addListener: (event: 'onStopLending', listener: () => void) => { remove: () => void };
};

/** The foreground service lives in the local Expo module. Missing native code is a no-op, not a crash. */
export function loadLendService(): LendServiceNative | null {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeModule<LendServiceNative>('LendService');
  } catch {
    return null;
  }
}
