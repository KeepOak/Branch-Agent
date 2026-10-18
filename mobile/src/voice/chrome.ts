import { Platform } from 'react-native';
import { voiceChrome } from '../theme/tokens';

/**
 * Voice chrome: black and white by default, with the desktop window's type, glass and radii
 * (window/src/theme/tokens.css --fs-*, --gc-/--gf-/--gk-*, --r1-17…--r-pill). Local to Voice so
 * other phone screens keep their own tokens. Colours live in tokens.ts.
 */
export const voice = voiceChrome;

/** Desktop type sizes (--fs-11 … --fs-26). */
export const voiceType = {
  fs11: { fontSize: 11, lineHeight: 13, fontWeight: '400' as const, letterSpacing: 0 },
  fs12: { fontSize: 12, lineHeight: 16, fontWeight: '400' as const, letterSpacing: 0 },
  fs13: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const, letterSpacing: 0 },
  fs15: { fontSize: 15, lineHeight: 20, fontWeight: '400' as const, letterSpacing: 0 },
  fs17: { fontSize: 17, lineHeight: 22, fontWeight: '400' as const, letterSpacing: 0 },
  fs26: { fontSize: 26, lineHeight: 32, fontWeight: '500' as const, letterSpacing: 0 },
} as const;

export type VoiceTypeName = keyof typeof voiceType;

/** Desktop radii (--r1-17 8, --r2-17 12, --r3-17 16, --r4-17 20, --r-pill 999, --r-row 14). */
export const voiceRadius = {
  r1: 8,
  r2: 12,
  r3: 16,
  r4: 20,
  pill: 999,
  row: 14,
} as const;

/** Desktop sans stack (--sans). Native screens use the system face at the same sizes. */
export const voiceSans = Platform.select({
  web: '"Geist", "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
  default: undefined,
});
