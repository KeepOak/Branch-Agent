import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type AssistantNative = {
  takeAssist: () => boolean;
  addListener: (event: 'onAssist', listener: () => void) => { remove: () => void };
};

/** The assist entry point lives in the local Expo module. Missing native code is a no-op, not a crash. */
export function loadAssistant(): AssistantNative | null {
  if (Platform.OS !== 'android') return null;
  try {
    return requireNativeModule<AssistantNative>('Assistant');
  } catch {
    return null;
  }
}
