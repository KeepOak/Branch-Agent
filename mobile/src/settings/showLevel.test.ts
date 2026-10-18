import { memoryStore } from '../storage/keyValueStore';
import { laterUpdate, parseShowLevel, readShowLevel, settingsLevelOf, showLevelOf, SHOW_LEVEL_KEY, showsLaterUpdates, writeShowLevel } from './showLevel';

describe('show level', () => {
  it('treats anything but Advanced or Technical as Regular', () => {
    expect(parseShowLevel('regular')).toBe('regular');
    expect(parseShowLevel('advanced')).toBe('advanced');
    expect(parseShowLevel('technical')).toBe('technical');
    expect(parseShowLevel(null)).toBe('regular');
    expect(parseShowLevel('other')).toBe('regular');
  });

  it('maps Regular, Advanced and Technical to the Settings ranks', () => {
    expect(settingsLevelOf('regular')).toBe(0);
    expect(settingsLevelOf('advanced')).toBe(1);
    expect(settingsLevelOf('technical')).toBe(2);
    expect(showLevelOf(0)).toBe('regular');
    expect(showLevelOf(1)).toBe('advanced');
    expect(showLevelOf(2)).toBe('technical');
  });

  it('shows unfinished rows only at Advanced and above', () => {
    expect(showsLaterUpdates('regular')).toBe(false);
    expect(showsLaterUpdates('advanced')).toBe(true);
    expect(showsLaterUpdates('technical')).toBe(true);
    expect(laterUpdate('Canopy')).toBe('Canopy comes in a later update.');
  });

  it('reads a saved choice and drops the key for Regular', async () => {
    const store = memoryStore({ [SHOW_LEVEL_KEY]: 'advanced' });
    expect(await readShowLevel(store)).toBe('advanced');
    await writeShowLevel(store, 'regular');
    expect(store.dump()[SHOW_LEVEL_KEY]).toBeUndefined();
    await writeShowLevel(store, 'technical');
    expect(store.dump()[SHOW_LEVEL_KEY]).toBe('technical');
  });
});
