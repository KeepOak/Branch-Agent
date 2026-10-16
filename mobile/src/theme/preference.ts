// Light, dark, or follow the phone (the window's branch.theme choice, on this device).
import type { KeyValueStore } from '../storage/keyValueStore';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCE_KEY = 'branch.theme';

export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export async function readThemePreference(store: KeyValueStore): Promise<ThemePreference> {
  return parseThemePreference(await store.get(THEME_PREFERENCE_KEY));
}

export async function writeThemePreference(store: KeyValueStore, preference: ThemePreference): Promise<void> {
  if (preference === 'system') await store.remove(THEME_PREFERENCE_KEY);
  else await store.set(THEME_PREFERENCE_KEY, preference);
}
