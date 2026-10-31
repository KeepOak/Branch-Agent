// How much to show (window/src/places-nav/level.ts): Regular, Advanced or Technical.
// Unfinished features use later() and only appear at Advanced and above (extras off at Regular).

export type Level = 'regular' | 'advanced' | 'technical';

const ORDER: Level[] = ['regular', 'advanced', 'technical'];

/** True when a row marked for `min` shows at `level`. */
export function shows(level: Level, min: Level): boolean {
  return ORDER.indexOf(level) >= ORDER.indexOf(min);
}

/** Unfinished-feature copy: "<label> comes in a later update." */
export function later(label: string): string {
  return `${label} comes in a later update.`;
}
