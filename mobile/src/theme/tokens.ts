// Branch phone theme tokens. Every colour, size and motion value the app draws with lives here;
// screens read them through useTheme() and never hardcode their own. Colours follow the desktop
// Branch Slate palette (window/src/theme/tokens.css). Type, glass and radii on Settings follow
// that same desktop token file (--fs-*, --glass17, --r1-17 through --r-row).

export type ColorScheme = 'light' | 'dark';

export interface Palette {
  /** Screen background. */
  bg: string;
  /** Grouped background behind inset cards. */
  grouped: string;
  /** Raised surface: cards, sheets, bubbles from Trunks. */
  raise: string;
  /** Primary text. */
  ink: string;
  /** Secondary text. */
  ink2: string;
  /** Tertiary text: footnotes, timestamps. */
  ink3: string;
  /** Hairline separators. */
  line: string;
  /** Quiet fills: search field, idle chips. */
  fill: string;
  /** Brand accent: the user's own bubbles, the send button, selection. */
  accent: string;
  /** Accent used as text on bg or raise. */
  accentInk: string;
  /** Soft accent background. */
  accentTint: string;
  /** Text or icon on an accent fill. */
  onAccent: string;
  ok: string;
  okTint: string;
  warn: string;
  warnTint: string;
  bad: string;
  badTint: string;
  /** Dimmed backdrop behind sheets. */
  scrim: string;
  /** Behind the live camera, before the first frame arrives. */
  camera: string;
  /** Desktop --glass17: raised surface at 90% (cards on Settings). */
  glass: string;
}

const light: Palette = {
  bg: '#f6f8f9',
  grouped: '#edf1f3',
  raise: '#ffffff',
  ink: '#141d24',
  ink2: '#3a4751',
  ink3: '#5f6c76',
  line: '#dfe5e9',
  fill: '#ecf0f3',
  accent: '#484ce5',
  accentInk: '#3a3eba',
  accentTint: '#e9efff',
  onAccent: '#ffffff',
  ok: '#2f8f5b',
  okTint: '#e2f0e7',
  warn: '#a86e12',
  warnTint: '#f6ebd5',
  bad: '#c2412d',
  badTint: '#f8e3df',
  scrim: 'rgba(14, 20, 26, 0.3)',
  camera: '#000000',
  glass: 'rgba(255, 255, 255, 0.9)',
};

// Dark is near-black like Grok and iOS dark mode: deep enough for OLED, with raised surfaces a step lighter.
const dark: Palette = {
  bg: '#0b0f12',
  grouped: '#0b0f12',
  raise: '#161d22',
  ink: '#e6ecf0',
  ink2: '#aebac3',
  ink3: '#85929b',
  line: '#232d34',
  fill: '#182026',
  accent: '#6064e4',
  accentInk: '#b4bbfe',
  accentTint: '#1e2144',
  onAccent: '#ffffff',
  ok: '#5cc08a',
  okTint: '#16291d',
  warn: '#e0af3b',
  warnTint: '#2e2412',
  bad: '#f0806c',
  badTint: '#361c17',
  scrim: 'rgba(0, 0, 0, 0.52)',
  camera: '#000000',
  glass: 'rgba(22, 29, 34, 0.9)',
};

export const palettes: Record<ColorScheme, Palette> = { light, dark };

export interface TextStyleToken {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
  letterSpacing: number;
}

// Apple's iPhone text styles at the default Dynamic Type size, with SF Pro tracking.
export const type = {
  largeTitle: { fontSize: 34, lineHeight: 41, fontWeight: '700', letterSpacing: 0.4 },
  title1: { fontSize: 28, lineHeight: 34, fontWeight: '700', letterSpacing: 0.38 },
  title2: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.26 },
  title3: { fontSize: 20, lineHeight: 25, fontWeight: '600', letterSpacing: -0.45 },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.43 },
  body: { fontSize: 17, lineHeight: 22, fontWeight: '400', letterSpacing: -0.43 },
  callout: { fontSize: 16, lineHeight: 21, fontWeight: '400', letterSpacing: -0.31 },
  subhead: { fontSize: 15, lineHeight: 20, fontWeight: '400', letterSpacing: -0.23 },
  footnote: { fontSize: 13, lineHeight: 18, fontWeight: '400', letterSpacing: -0.08 },
  caption1: { fontSize: 12, lineHeight: 16, fontWeight: '400', letterSpacing: 0 },
  caption2: { fontSize: 11, lineHeight: 13, fontWeight: '400', letterSpacing: 0.06 },
  /** Desktop --fs-26, the Settings page title. */
  settingsTitle: { fontSize: 26, lineHeight: 32, fontWeight: '600', letterSpacing: -0.4 },
  /** Desktop settings body (15 / 20). */
  settingsBody: { fontSize: 15, lineHeight: 20, fontWeight: '400', letterSpacing: -0.2 },
  /** Desktop --fs-label, uppercase group titles. */
  settingsLabel: { fontSize: 11, lineHeight: 14, fontWeight: '500', letterSpacing: 0.6 },
} as const satisfies Record<string, TextStyleToken>;

export type TypeName = keyof typeof type;

/** 4-point grid. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

/** Margins that line up with iOS navigation bars and inset grouped lists. */
export const layout = { screenInset: 20, cardInset: 16, rowMinHeight: 44, hairline: 0.5 } as const;

/** Desktop radii (--r1-17 8, --r2-17 12, --r3-17 16, --r4-17 20, --r-row 14). */
export const radius = { sm: 8, md: 12, lg: 16, bubble: 20, row: 14, pill: 999 } as const;

/** Spring settings for native-feeling motion (React Native Animated.spring). */
export const motion = {
  snappy: { damping: 22, stiffness: 320, mass: 1 },
  gentle: { damping: 26, stiffness: 180, mass: 1 },
  fadeMs: 180,
} as const;

export interface Theme {
  scheme: ColorScheme;
  color: Palette;
  type: typeof type;
  space: typeof space;
  layout: typeof layout;
  radius: typeof radius;
  motion: typeof motion;
}

export function glassOf(raise: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(raise);
  if (!hex) return raise;
  const n = hex[1];
  const r = Number.parseInt(n.slice(0, 2), 16);
  const g = Number.parseInt(n.slice(2, 4), 16);
  const b = Number.parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.9)`;
}

export function themeFor(scheme: ColorScheme, overlay?: Partial<Palette>): Theme {
  const color = overlay ? { ...palettes[scheme], ...overlay, glass: overlay.glass ?? glassOf(overlay.raise ?? palettes[scheme].raise) } : palettes[scheme];
  return { scheme, color, type, space, layout, radius, motion };
}

/**
 * Pairing chrome is black and white: primary actions use ink on the screen background, never the
 * indigo accent. Status colours (ok / warn / bad) stay so a failed or expired code still reads.
 */
export function pairingTheme(theme: Theme): Theme {
  const { color, scheme } = theme;
  return {
    ...theme,
    color: {
      ...color,
      accent: color.ink,
      accentInk: color.ink,
      accentTint: color.fill,
      onAccent: scheme === 'dark' ? color.bg : '#ffffff',
    },
  };
}
