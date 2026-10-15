// Mock engine state for the button crawl. Every crawl click starts from these values, so one control's
// config.patch or users.prefs.set cannot disable or change the next control's result.

export type CrawlConfig = { hash: string; config: Record<string, unknown> };
export type CrawlPrefs = { status: string; entries: Record<string, unknown> };
/** Reply voice, as the engine keeps it (gateway tts.ts): autoMode, the active provider and persona, and the providers. */
export type CrawlVoice = {
  auto: 'off' | 'inbound' | 'tagged' | 'always';
  provider: string;
  persona: string | null;
  personas: { id: string; label: string; description: string; provider: string }[];
  providers: { id: string; name: string; configured: boolean; models: string[]; voices: string[] }[];
};
/** The engine's exec approvals file (exec.approvals.get / set), as the Permissions page reads and saves it. */
export type CrawlApprovals = { path: string; exists: boolean; hash: string; file: Record<string, unknown>; resolvedDefaults: Record<string, unknown> };

const INITIAL_CONFIG: CrawlConfig = {
  hash: 'fixture',
  config: { wizard: { lastRunAt: '2026-10-01T00:00:00Z' }, agents: { defaults: { model: { primary: 'local/fixture' } } } },
};

const INITIAL_PREFS: CrawlPrefs = { status: 'ok', entries: {} };

const INITIAL_VOICE: CrawlVoice = {
  auto: 'off', provider: 'local', persona: null, personas: [],
  providers: [{ id: 'local', name: 'On this computer', configured: true, models: [], voices: [] }],
};

const INITIAL_APPROVALS: CrawlApprovals = {
  path: 'exec-approvals.json',
  exists: true,
  hash: 'approvals-0',
  file: { version: 1, defaults: { security: 'full', ask: 'off', askFallback: 'deny', autoAllowSkills: false } },
  resolvedDefaults: { security: 'full', ask: 'off', askFallback: 'deny', autoAllowSkills: false },
};

export function freshConfig(): CrawlConfig {
  return structuredClone(INITIAL_CONFIG);
}

export function freshPrefs(): CrawlPrefs {
  return structuredClone(INITIAL_PREFS);
}

export function freshApprovals(): CrawlApprovals {
  return structuredClone(INITIAL_APPROVALS);
}

/** exec.approvals.set: refuses a stale base hash (as the engine does), otherwise saves the file and returns the new snapshot. */
export function applyApprovalsSet(current: CrawlApprovals, params: { file?: Record<string, unknown>; baseHash?: string }): CrawlApprovals {
  // The engine's own wording (gateway exec-approvals.ts), which the Permissions page matches to offer a reload.
  if (params.baseHash !== current.hash) throw new Error('exec approvals changed since last load; re-run exec.approvals.get and retry');
  const next = { ...current, file: params.file ?? current.file, hash: `approvals-${Date.now().toString(36)}` };
  const defaults = (next.file.defaults ?? {}) as Record<string, unknown>;
  next.resolvedDefaults = { ...INITIAL_APPROVALS.resolvedDefaults, ...defaults };
  return next;
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

export function freshVoice(): CrawlVoice {
  return structuredClone(INITIAL_VOICE);
}

/** tts.enable turns reading aloud on for every reply; tts.disable turns it off. */
export function applyVoiceToggle(current: CrawlVoice, enabled: boolean): CrawlVoice {
  return { ...current, auto: enabled ? 'always' : 'off' };
}

/** The tts.status payload (gateway tts.ts "tts.status": enabled, auto, provider, persona, personas, fallback, prefsPath, providerStates). */
export function voiceStatus(v: CrawlVoice) {
  return {
    enabled: v.auto !== 'off',
    auto: v.auto,
    provider: v.provider,
    persona: v.persona,
    personas: v.personas,
    fallbackProvider: null,
    fallbackProviders: [] as string[],
    prefsPath: 'tts-prefs.json',
    providerStates: v.providers.map((p) => ({ id: p.id, label: p.name, configured: p.configured })),
  };
}

/** The tts.providers payload (gateway tts.ts "tts.providers": providers with id, name, configured, models, voices; and active). */
export function voiceProviders(v: CrawlVoice) {
  return { providers: v.providers, active: v.provider };
}
