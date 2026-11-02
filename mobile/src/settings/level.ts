/** How much the phone shows: Regular, Advanced or Technical. Same ranks as the window (lvPG18). */
export type ExperienceLevel = 'regular' | 'advanced' | 'technical';

/** 0 Regular · 1 Advanced · 2 Technical. Unfinished rows wait for Advanced. */
export function levelRank(level: ExperienceLevel): 0 | 1 | 2 {
  if (level === 'technical') return 2;
  if (level === 'advanced') return 1;
  return 0;
}

/** The preview's unfinished-row line. Shown only at Advanced and above. */
export function laterUpdate(label: string): string {
  return `${label} comes in a later update.`;
}
