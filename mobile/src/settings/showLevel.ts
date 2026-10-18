// How much Settings, More and Profile show. Regular is the default (the essentials).
// Unfinished rows appear only at Advanced and above, with "<label> comes in a later update."

import type { KeyValueStore } from '../storage/keyValueStore';

export type ShowLevel = 'regular' | 'advanced' | 'technical';

export function settingsLevelOf(level: ShowLevel): 0 | 1 | 2 {
  return level === 'technical' ? 2 : level === 'advanced' ? 1 : 0;
}

export function showLevelOf(level: 0 | 1 | 2): ShowLevel {
  return level === 2 ? 'technical' : level === 1 ? 'advanced' : 'regular';
}

export const SHOW_LEVEL_KEY = 'branch.showLevel';

export const SHOW_LEVEL_OPTIONS: { value: ShowLevel; label: string; hint: string }[] = [
  { value: 'regular', label: 'Regular', hint: 'The essentials, in plain words.' },
  { value: 'advanced', label: 'Advanced', hint: 'Every feature and the fine controls.' },
  { value: 'technical', label: 'Technical', hint: 'File paths, raw keys, launch variables, config and logs.' },
];

export function parseShowLevel(value: string | null | undefined): ShowLevel {
  return value === 'advanced' || value === 'technical' ? value : 'regular';
}

export function showsLaterUpdates(level: ShowLevel): boolean {
  return level === 'advanced' || level === 'technical';
}

export function laterUpdate(label: string): string {
  return `${label} comes in a later update.`;
}

export async function readShowLevel(store: KeyValueStore): Promise<ShowLevel> {
  return parseShowLevel(await store.get(SHOW_LEVEL_KEY));
}

export async function writeShowLevel(store: KeyValueStore, level: ShowLevel): Promise<void> {
  if (level === 'regular') await store.remove(SHOW_LEVEL_KEY);
  else await store.set(SHOW_LEVEL_KEY, level);
}
