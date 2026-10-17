import { Platform } from 'react-native';

/**
 * Voice chrome: black and white by default, with the desktop window's type, glass and radii
 * (window/src/theme/tokens.css --fs-*, --gc-/--gf-/--gk-*, --r1-17…--r-pill). Local to Voice so
 * other phone screens keep their own tokens.
 */
export const voice = {
  bg: '#000000',
  ink: '#ffffff',
  ink2: '#c8c8c8',
  ink3: '#9a9a9a',
  /** Control glass fill, B&W stand-in for dark --gc-fill. */
  gcFill: 'rgba(255,255,255,0.12)',
  gcEdge: 'rgba(255,255,255,0.14)',
  gcHi: 'rgba(255,255,255,0.12)',
  /** Floating glass fill, B&W stand-in for dark --gf-fill. */
  gfFill: 'rgba(255,255,255,0.12)',
  gfEdge: 'rgba(255,255,255,0.09)',
  /** Chip glass: --gk-chip / --gk-on. */
  gkChip: 'rgba(255,255,255,0.055)',
  gkOn: 'rgba(255,255,255,0.13)',
  ring: 'rgba(255,255,255,0.35)',
  scrim: 'rgba(0,0,0,0.45)',
} as const;

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
