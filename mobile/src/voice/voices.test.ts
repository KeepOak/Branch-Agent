import { PREVIEW_VOICES, VOICE_EVERYWHERE, selectedVoiceId, speaksEverywhere, voiceLabel, voicesFromStatus } from './voices';

describe('r50 Oak/Birch voice list', () => {
  it('uses Oak and Birch when the engine lists no named voices', () => {
    expect(voicesFromStatus(undefined)).toEqual(PREVIEW_VOICES);
    expect(voicesFromStatus({})).toEqual(PREVIEW_VOICES);
    expect(voicesFromStatus({ personas: [] })).toEqual(PREVIEW_VOICES);
    expect(VOICE_EVERYWHERE).toBe('Changing it changes the voice everywhere.');
  });

  it('keeps the engine’s named voices when tts.status has them', () => {
    expect(
      voicesFromStatus({
        personas: [
          { id: 'oak', label: 'Oak' },
          { id: 'birch', label: 'Birch' },
        ],
      }),
    ).toEqual(PREVIEW_VOICES);
  });

  it('selects the active persona by id or label, and Oak when unset', () => {
    const voices = PREVIEW_VOICES;
    expect(selectedVoiceId({ persona: 'birch' }, voices)).toBe('birch');
    expect(selectedVoiceId({ persona: 'Birch' }, voices)).toBe('birch');
    expect(selectedVoiceId({ persona: null }, voices)).toBe('oak');
    expect(selectedVoiceId({}, voices)).toBe('oak');
    expect(voiceLabel('birch', voices)).toBe('Birch');
    expect(speaksEverywhere('Birch')).toBe('Birch speaks everywhere now.');
  });
});
