import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Small string storage for the device key, the engine's device token and the pairing record. */
export type KeyValueStore = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

/** In-memory store for tests and screenshots. */
export function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { dump: () => Record<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    get: async (key) => data.get(key) ?? null,
    set: async (key, value) => {
      data.set(key, value);
    },
    remove: async (key) => {
      data.delete(key);
    },
    dump: () => Object.fromEntries(data),
  };
}

/**
 * The phone's Keychain (iOS) or Keystore-backed storage (Android) through expo-secure-store. The web
 * preview has no secure enclave, so it keeps the same keys in the page's localStorage.
 */
export function deviceStore(): KeyValueStore {
  if (Platform.OS === 'web') {
    return {
      get: async (key) => globalThis.localStorage.getItem(key),
      set: async (key, value) => globalThis.localStorage.setItem(key, value),
      remove: async (key) => globalThis.localStorage.removeItem(key),
    };
  }
  return {
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value),
    remove: (key) => SecureStore.deleteItemAsync(key),
  };
}
