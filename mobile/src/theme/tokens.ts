// Branch phone theme tokens. Every colour, size and motion value the app draws with lives here;
// screens read them through useTheme() and never hardcode their own. Colours are grayscale
// (black, white and greys only) so the Android r50 rebuild stays black-and-white by default;
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
  bg: '#f8f8f8',
  grouped: '#f0f0f0',
  raise: '#ffffff',
  ink: '#1c1c1c',
  ink2: '#454545',
  ink3: '#6a6a6a',
  line: '#e4e4e4',
  fill: '#efefef',
  accent: '#565656',
  accentInk: '#464646',
  accentTint: '#efefef',
  onAccent: '#ffffff',
  ok: '#777777',
  okTint: '#ececec',
  warn: '#747474',
  warnTint: '#ececec',
  bad: '#5b5b5b',
  badTint: '#e7e7e7',
  scrim: 'rgba(19, 19, 19, 0.3)',
  camera: '#000000',
};

// Dark is near-black like Grok and iOS dark mode: deep enough for OLED, with raised surfaces a step lighter.
const dark: Palette = {
  bg: '#0e0e0e',
  grouped: '#0e0e0e',
  raise: '#1c1c1c',
  ink: '#ebebeb',
  ink2: '#b8b8b8',
  ink3: '#909090',
  line: '#2b2b2b',
  fill: '#1f1f1f',
  accent: '#6c6c6c',
  accentInk: '#bebebe',
  accentTint: '#232323',
  onAccent: '#ffffff',
  ok: '#a7a7a7',
  okTint: '#242424',
  warn: '#b1b1b1',
  warnTint: '#252525',
  bad: '#969696',
  badTint: '#212121',
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
