// Branch phone theme tokens. Every colour, size and motion value the app draws with lives here;
// screens read them through useTheme() and never hardcode their own. Colours follow the desktop
// Branch Slate palette (window/src/theme/tokens.css) so the phone and the window feel like one product;
// type, spacing and radii follow Apple's Human Interface Guidelines for iPhone.

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
} as const satisfies Record<string, TextStyleToken>;

export type TypeName = keyof typeof type;

/** 4-point grid. */
export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

/** Margins that line up with iOS navigation bars and inset grouped lists. */
export const layout = { screenInset: 20, cardInset: 16, rowMinHeight: 44, hairline: 0.5 } as const;

export const radius = { sm: 8, md: 12, lg: 16, bubble: 20, pill: 999 } as const;

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

export function themeFor(scheme: ColorScheme): Theme {
  return { scheme, color: palettes[scheme], type, space, layout, radius, motion };
}
