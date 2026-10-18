// Copied from the desktop theme catalogue (window appearance-look / appearance-legacy,
// engine BUILTIN_THEMES). Grove is shown as Branch Slate, the window's own tokens.
import { DESKTOP_LOOK_PALETTES, palettes, toGrayscale, type ColorScheme, type Palette } from './tokens';

export const DEFAULT_THEME_ID = 'grove';

export type DesktopTheme = { id: string; name: string };

export const DESKTOP_THEMES: readonly DesktopTheme[] = [
  { id: 'grove', name: 'Branch Slate' },
  { id: 'knot', name: 'Knot' },
  { id: 'dash', name: 'Dash' },
  { id: 'absolutely', name: 'Absolutely' },
  { id: 'tide', name: 'Tide' },
  { id: 'beacon', name: 'Beacon' },
  { id: 'phosphor', name: 'Phosphor' },
  { id: 'crt', name: 'CRT' },
  { id: 'manuscript', name: 'Manuscript' },
  { id: 'rose', name: 'Rosé' },
  { id: 'miami', name: 'Miami' },
  { id: 'paper', name: 'Paper' },
  { id: 'forest', name: 'Forest' },
  { id: 'earth', name: 'Earth' },
  { id: 'slate', name: 'Slate' },
  { id: 'nocturne', name: 'Nocturne' },
  { id: 'arctic', name: 'Arctic' },
  { id: 'terracotta', name: 'Terracotta' },
  { id: 'lavender', name: 'Lavender' },
  { id: 'mint', name: 'Mint' },
  { id: 'cherry', name: 'Cherry' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'sunset', name: 'Sunset' },
  { id: 'sepia', name: 'Sepia' },
  { id: 'meadow', name: 'Meadow' },
  { id: 'stone', name: 'Stone' },
  { id: 'harbor', name: 'Harbor' },
  { id: 'signal', name: 'Midnight Signal' },
  { id: 'mono', name: 'Mono' },
  { id: 'amber-crt', name: 'Amber terminal' },
  { id: 'green-crt', name: 'Green terminal' },
  { id: 'catppuccin', name: 'Catppuccin' },
  { id: 'nord', name: 'Nord' },
  { id: 'dracula', name: 'Dracula' },
  { id: 'solarized', name: 'Solarized' },
  { id: 'gruvbox', name: 'Gruvbox' },
  { id: 'rose-pine', name: 'Rosé Pine' },
  { id: 'rose-pine-moon', name: 'Rosé Pine Moon' },
  { id: 'tokyo-night', name: 'Tokyo Night' },
  { id: 'everforest', name: 'Everforest' },
  { id: 'one-dark', name: 'One Dark' },
  { id: 'monokai', name: 'Monokai Pro' },
  { id: 'ayu', name: 'Ayu' },
  { id: 'ayu-mirage', name: 'Ayu Mirage' },
  { id: 'kanagawa', name: 'Kanagawa' },
  { id: 'palenight', name: 'Palenight' },
  { id: 'material-ocean', name: 'Material Ocean' },
  { id: 'github', name: 'GitHub' },
  { id: 'horizon', name: 'Horizon' },
  { id: 'synthwave', name: 'Synthwave' },
  { id: 'night-owl', name: 'Night Owl' },
  { id: 'poimandres', name: 'Poimandres' },
  { id: 'vesper', name: 'Vesper' },
  { id: 'flexoki', name: 'Flexoki' },
  { id: 'oceanic', name: 'Oceanic Next' },
  { id: 'nightfox', name: 'Nightfox' },
];

type Slice = Pick<Palette, 'bg' | 'grouped' | 'raise' | 'ink' | 'ink2' | 'ink3' | 'line' | 'fill' | 'accent' | 'accentInk' | 'onAccent' | 'ok' | 'warn' | 'bad'>;

export function desktopThemeName(id: string): string {
  return DESKTOP_THEMES.find((theme) => theme.id === id)?.name ?? DESKTOP_THEMES[0].name;
}

export function isDesktopThemeId(id: string): boolean {
  return DESKTOP_THEMES.some((theme) => theme.id === id);
}

function tokenSlice(scheme: ColorScheme): Slice {
  const color = palettes[scheme];
  return {
    bg: color.bg,
    grouped: color.grouped,
    raise: color.raise,
    ink: color.ink,
    ink2: color.ink2,
    ink3: color.ink3,
    line: color.line,
    fill: color.fill,
    accent: color.accent,
    accentInk: color.accentInk,
    onAccent: color.onAccent,
    ok: color.ok,
    warn: color.warn,
    bad: color.bad,
  };
}

function graySlice(slice: Slice): Slice {
  const out = { ...slice };
  for (const key of Object.keys(out) as (keyof Slice)[]) out[key] = toGrayscale(slice[key]);
  return out;
}

export function paletteSliceFor(id: string, scheme: ColorScheme): Slice {
  const key = isDesktopThemeId(id) ? id : DEFAULT_THEME_ID;
  if (key === DEFAULT_THEME_ID) return tokenSlice(scheme);
  const pal = DESKTOP_LOOK_PALETTES[key] ?? DESKTOP_LOOK_PALETTES[DEFAULT_THEME_ID];
  return graySlice(pal[scheme] as Slice);
}
