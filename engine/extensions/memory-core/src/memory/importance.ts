function importanceMultiplier(importance: number | null | undefined): number {
  // Unavailable metadata carries no importance signal; preserve recall confidence.
  if (importance === null || importance === undefined || !Number.isFinite(importance)) {
    return 1;
  }
  const bounded = Math.max(1, Math.min(10, Math.floor(importance)));
  return 0.75 + bounded * 0.05;
}

export function applyImportanceMultiplier<T extends { score: number; importance?: number }>(
  results: T[],
): T[] {
  return results.map((entry) => ({
    ...entry,
    score: entry.score * importanceMultiplier(entry.importance),
  }));
}
