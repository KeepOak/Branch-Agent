// r50 Voice sheet (design/spec-v23 ph-voicemenuPG18): Oak and Birch, saved everywhere.
// The engine's named voices come from tts.status; a pick writes tts.setPersona, as desktop Voice does.

export type VoiceChoice = { id: string; label: string };

/** Preview defaults when the engine has no named voices yet. */
export const PREVIEW_VOICES: VoiceChoice[] = [
  { id: 'oak', label: 'Oak' },
  { id: 'birch', label: 'Birch' },
];

export const VOICE_EVERYWHERE = 'Changing it changes the voice everywhere.';

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Named voices from tts.status; Oak and Birch when the engine lists none. */
export function voicesFromStatus(data: unknown): VoiceChoice[] {
  const raw = rec(data).personas;
  if (!Array.isArray(raw)) return PREVIEW_VOICES;
  const voices: VoiceChoice[] = [];
  for (const item of raw) {
    const row = rec(item);
    const id = str(row.id);
    if (!id) continue;
    voices.push({ id, label: str(row.label) || id });
  }
  return voices.length ? voices : PREVIEW_VOICES;
}

/** The active persona id from tts.status, matched by id or label; Oak when unset. */
export function selectedVoiceId(data: unknown, voices: VoiceChoice[], fallback = 'oak'): string {
  const persona = str(rec(data).persona).toLowerCase();
  if (voices.some((v) => v.id === persona)) return persona;
  const byLabel = voices.find((v) => v.label.toLowerCase() === persona);
  if (byLabel) return byLabel.id;
  return voices.some((v) => v.id === fallback) ? fallback : (voices[0]?.id ?? fallback);
}

export function voiceLabel(id: string, voices: VoiceChoice[]): string {
  return voices.find((v) => v.id === id)?.label ?? id;
}

/** The r50 toast after a pick: "<Oak|Birch> speaks everywhere now." */
export function speaksEverywhere(label: string): string {
  return `${label} speaks everywhere now.`;
}
