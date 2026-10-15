// Mock engine state for the button crawl. Every crawl click starts from these values, so one control's
// config.patch or users.prefs.set cannot disable or change the next control's result.

export type CrawlConfig = { hash: string; config: Record<string, unknown> };
export type CrawlPrefs = { status: string; entries: Record<string, unknown> };

const INITIAL_CONFIG: CrawlConfig = {
  hash: 'fixture',
  config: { wizard: { lastRunAt: '2026-10-01T00:00:00Z' }, agents: { defaults: { model: { primary: 'local/fixture' } } } },
};

const INITIAL_PREFS: CrawlPrefs = { status: 'ok', entries: {} };

export function freshConfig(): CrawlConfig {
  return structuredClone(INITIAL_CONFIG);
}

export function freshPrefs(): CrawlPrefs {
  return structuredClone(INITIAL_PREFS);
}

/** Deep merge for config.patch: null deletes a key, arrays and scalars replace. Never mutates its inputs. */
export function mergeConfig(base: unknown, patch: unknown): unknown {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out: Record<string, unknown> = base && typeof base === 'object' && !Array.isArray(base) ? { ...(base as Record<string, unknown>) } : {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) delete out[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)) out[key] = mergeConfig(out[key], value);
    else out[key] = value;
  }
  return out;
}

/** config.patch: a new config with its hash changed, built from the current one. */
export function applyConfigPatch(current: CrawlConfig, rawPatch: string): CrawlConfig {
  const patch = JSON.parse(rawPatch || '{}') as unknown;
  return { ...current, hash: `${current.hash}x`, config: mergeConfig(current.config, patch) as Record<string, unknown> };
}

/** users.prefs.set: a new prefs object. A null entry removes the key. */
export function applyPrefsSet(current: CrawlPrefs, entries: Record<string, unknown>): CrawlPrefs {
  const next = { ...current.entries };
  for (const [key, value] of Object.entries(entries)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return { status: 'ok', entries: next };
}
