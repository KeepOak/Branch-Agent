import { spokenAnswer } from './spokenAnswer';

describe('spokenAnswer', () => {
  it('treats a whole yes as allow-once and a whole no as deny', () => {
    expect(spokenAnswer('Yes, go ahead.')).toBe('allow-once');
    expect(spokenAnswer('  Yep! ')).toBe('allow-once');
    expect(spokenAnswer('send it')).toBe('allow-once');
    expect(spokenAnswer('No thanks')).toBe('deny');
    expect(spokenAnswer('Don’t send it')).toBe('deny');
    expect(spokenAnswer('no')).toBe('deny');
  });

  it('does not treat a leading yes with more after it as consent', () => {
    expect(spokenAnswer("yes but don't send it")).toBeNull();
    expect(spokenAnswer('yes but don’t send it')).toBeNull();
    expect(spokenAnswer('yeah, wait')).toBeNull();
    expect(spokenAnswer('okay so what is it')).toBeNull();
    expect(spokenAnswer('what is it?')).toBeNull();
  });
});
