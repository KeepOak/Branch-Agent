// What the Android lending notification says, and whether it shows at all. The foreground service runs only
// while this phone is paired, lending is on and at least one ability is switched on (Settings › Lend this phone).
import { LEND_ABILITIES, type PhonePrefs } from '../settings/phonePrefs';

export const LEND_STOP_LABEL = 'Stop lending';

export type LendNotice = { title: string; text: string; stopLabel: string };

/** The abilities this phone lends right now, in Settings order. */
export function lentAbilities(prefs: PhonePrefs): string[] {
  if (!prefs.lendOn) return [];
  return LEND_ABILITIES.filter((row) => prefs.lend[row.id]).map((row) => row.label);
}

/** The ongoing notification while lending, or null when the service should not run. */
export function lendNotice(input: { paired: boolean; online: boolean; prefs: PhonePrefs }): LendNotice | null {
  if (!input.paired) return null;
  const lent = lentAbilities(input.prefs);
  if (lent.length === 0) return null;
  return {
    title: 'This phone is lent to Branch Agent',
    text: input.online ? `${lent.join(', ')}, when a Trunk asks` : 'Reconnecting to your computer…',
    stopLabel: LEND_STOP_LABEL,
  };
}

/** Prefs after a Stop on the notification: lending off, the per-ability choices kept for next time. */
export function stopLending(prefs: PhonePrefs): PhonePrefs {
  return { ...prefs, lend: { ...prefs.lend }, notifKinds: [...prefs.notifKinds], lendOn: false };
}
