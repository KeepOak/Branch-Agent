import { later, shows } from './level';

describe('voice level', () => {
  it('hides Advanced rows at Regular and shows them from Advanced up', () => {
    expect(shows('regular', 'advanced')).toBe(false);
    expect(shows('advanced', 'advanced')).toBe(true);
    expect(shows('technical', 'advanced')).toBe(true);
    expect(shows('regular', 'regular')).toBe(true);
  });

  it('writes unfinished-feature copy as "<label> comes in a later update."', () => {
    expect(later('Voice')).toBe('Voice comes in a later update.');
  });
});
