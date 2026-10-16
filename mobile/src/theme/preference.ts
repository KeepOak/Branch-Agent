// Light, dark, or follow the phone (the window's branch.theme choice, on this device).
import type { KeyValueStore } from '../storage/keyValueStore';
import { DEFAULT_THEME_ID, isDesktopThemeId } from './desktopThemes';

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCE_KEY = 'branch.theme';
export const THEME_LOOK_KEY = 'branch.look.theme';

export const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Match this phone' },
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

export function parseLookTheme(value: string | null | undefined): string {
  return value && isDesktopThemeId(value) ? value : DEFAULT_THEME_ID;
}

export async function readLookTheme(store: KeyValueStore): Promise<string> {
  return parseLookTheme(await store.get(THEME_LOOK_KEY));
}

export async function writeLookTheme(store: KeyValueStore, id: string): Promise<void> {
  const next = parseLookTheme(id);
  if (next === DEFAULT_THEME_ID) await store.remove(THEME_LOOK_KEY);
  else await store.set(THEME_LOOK_KEY, next);
}
