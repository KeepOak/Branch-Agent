// Settings › Appearance: the colours behind a theme (§4.7.3). Every look is thirteen colours per mode, the ones the
// "Make your own" editor shows; the window's tokens follow from them (the App Preview's varsFromEF). The built-in
// themes' colours are copied from the engine's own Control UI palettes (engine/ui/public/themes/*.css); Grove is the
// window's Branch Slate tokens (window/src/theme/tokens.css).

export const EF_KEYS = ["bg", "side", "raise", "ink", "ink2", "ink3", "line", "accent", "btn", "onBtn", "ok", "warn", "bad"] as const;
export type EfKey = (typeof EF_KEYS)[number];
export type Ef = Record<EfKey, string>;
export type Mode = "light" | "dark";
export type Pair = { light: Ef; dark: Ef; font?: string };

export const EF_LABELS: Record<EfKey, string> = {
  bg: "Background", side: "Sidebar", raise: "Cards and menus", ink: "Text", ink2: "Softer text", ink3: "Faint text", line: "Lines",
  accent: "Accent: things that want you", btn: "Buttons", onBtn: "Button text", ok: "Good", warn: "Careful", bad: "Problem",
};

const ef = (row: string): Ef => Object.fromEntries(row.split(" ").map((v, i) => [EF_KEYS[i], v])) as Ef;
const pair = (light: string, dark: string, font = ""): Pair => ({ light: ef(light), dark: ef(dark), ...(font ? { font } : {}) });

/** Branch Slate: the window's own tokens, which the default theme (Grove) draws with. */
export const SLATE = pair(
  "#f6f8f9 #edf1f3 #ffffff #141d24 #3a4751 #5f6c76 #dfe5e9 #484ce5 #16212a #f8fafb #2f8f5b #a86e12 #c2412d",
  "#0f1418 #0b0f12 #161d22 #e6ecf0 #aebac3 #85929b #1d262c #6064e4 #e8eef2 #11161a #5cc08a #e0af3b #f0806c",
);
export const DEFAULT_THEME = "grove";

/** The engine's built-in themes (BUILTIN_THEMES), light then dark, and the typeface each is drawn with. */
export const BUILTIN: Record<string, Pair> = {
  grove: SLATE,
  knot: pair("#f9f9fb #f2f2f5 #ffffff #18181b #3a3a42 #68676f #e2e2e8 #c41e30 #18181b #f9f9fb #166534 #92400e #b91c1c", "#080808 #0d0d0f #111113 #f5f5f7 #c6c6cb #8a8a94 #202026 #e5243b #f5f5f7 #080808 #22c55e #f59e0b #f87171", "geist"),
  dash: pair("#f7f2ec #f0e8e0 #ffffff #2c2118 #4a3828 #725d4d #ddd0c2 #8a512c #2c2118 #f7f2ec #166534 #92400e #b91c1c", "#1a1210 #201816 #221a16 #f0e4da #d8c8b8 #a18f80 #362a1c #cf8b4d #f0e4da #1a1210 #22c55e #f59e0b #f87171", "dm-sans"),
  absolutely: pair("#faf9f5 #f3f1e9 #ffffff #1f1d1a #3d3a33 #6b655b #e3dfd2 #a8452a #1f1d1a #faf9f5 #166534 #92400e #b91c1c", "#1c1c1a #232320 #232320 #f5f1e8 #e4dfd4 #aba498 #2e2c27 #d97757 #f5f1e8 #1c1c1a #22c55e #f59e0b #f87171", "space-grotesk"),
  tide: pair("#f7f9fb #eef2f7 #ffffff #1b232b #333c45 #5f6b76 #dfe5ec #1f6f8f #1b232b #f7f9fb #166534 #92400e #b91c1c", "#10151b #151b23 #161d25 #f2f6fa #c9d2da #9dabb9 #222c37 #5ab6d8 #f2f6fa #10151b #22c55e #f59e0b #f87171", "ibm-plex-sans"),
  beacon: pair("#ffffff #f4f4f4 #ffffff #000000 #000000 #3a3a3a #8a8a8a #6e4a00 #000000 #ffffff #0c5024 #613d00 #8c0f0f", "#000000 #0a0a0a #0a0a0a #ffffff #ffffff #c9c9c9 #4a4a4a #ffc233 #ffffff #000000 #5ee88a #ffc233 #ffabab", "atkinson-hyperlegible"),
  phosphor: pair("#f4f7f4 #ecf1ec #ffffff #16201a #2a352b #566b58 #dbe4dc #10693a #16201a #f4f7f4 #166534 #92400e #b91c1c", "#0a0f0a #0e150e #0e150e #e8f5e9 #cfe0cf #93ac95 #1d291f #4ade80 #e8f5e9 #0a0f0a #22c55e #f59e0b #f87171", "jetbrains-mono"),
  crt: pair("#f5f5f4 #ededed #ffffff #1b1b1b #373737 #5f5f5f #dddddd #1f1f1f #1b1b1b #f5f5f4 #166534 #92400e #b91c1c", "#090a09 #0e0e0e #0e0e0e #ececec #c6c6c6 #999999 #232323 #e8e8e8 #ececec #090a09 #22c55e #f59e0b #f87171", "jetbrains-mono"),
  manuscript: pair("#f6f1e4 #efe8d6 #fdfbf3 #1d1a12 #322d22 #6a604e #ddd2b8 #31549b #1d1a12 #f6f1e4 #166534 #92400e #b91c1c", "#211e18 #262218 #2a271f #efe8d6 #d8d0bc #ab9f84 #3b3527 #8fa8e0 #efe8d6 #211e18 #22c55e #f59e0b #f87171", "lora"),
  rose: pair("#faf4ed #f5ece2 #fffaf3 #292339 #3e3857 #665d87 #e3d9cb #9c4f66 #292339 #faf4ed #166534 #92400e #b91c1c", "#191724 #1d1b2a #1f1d2e #efedfa #d5d2eb #9793b0 #29263c #ebbcba #efedfa #191724 #22c55e #f59e0b #f87171", "dm-sans"),
  miami: pair("#f7f3f6 #f1e9f0 #fefcfe #241c2b #3c3244 #6b5f74 #e2d7e0 #b0246f #241c2b #f7f3f6 #166534 #92400e #b91c1c", "#140f1e #181226 #1c1530 #efeaf9 #cfc7e8 #968bbd #2c2150 #f472b6 #efeaf9 #140f1e #22c55e #f59e0b #f87171", "space-grotesk"),
};

export const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
/** a blended toward b by t (0 to 1). */
export function mix(a: string, b: string, t: number): string {
  if (!isHex(a) || !isHex(b)) return isHex(a) ? a : b;
  const x = rgb(a), y = rgb(b);
  return `#${x.map((v, i) => hex2(v + (y[i] - v) * t)).join("")}`;
}
const lum = (h: string) => {
  const [r, g, b] = rgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** The WCAG contrast ratio of two colours (1 to 21). */
export function contrast(a: string, b: string): number {
  if (!isHex(a) || !isHex(b)) return 1;
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** The window's tokens for one mode's thirteen colours. */
export function varsOf(c: Ef, mode: Mode): Record<string, string> {
  const dark = mode === "dark", bg = c.bg, t = c.ink;
  return {
    "--bg": bg, "--side": c.side, "--raise": c.raise, "--title": dark ? mix(c.side, "#000000", 0.3) : mix(c.side, t, 0.06),
    "--ink": t, "--ink-2": c.ink2, "--ink-3": c.ink3, "--line": c.line, "--line-2": mix(c.line, t, 0.14),
    "--fill": mix(bg, t, dark ? 0.07 : 0.05), "--fill-2": mix(bg, t, dark ? 0.12 : 0.09),
    ...accentVars(c.accent, bg, mode), "--brand-tint": mix(bg, c.ok, 0.16),
    "--btn": c.btn, "--on-btn": c.onBtn, "--ok": c.ok, "--ok-tint": mix(bg, c.ok, 0.14), "--warn": c.warn, "--warn-tint": mix(bg, c.warn, 0.14),
    "--bad": c.bad, "--bad-tint": mix(bg, c.bad, 0.14),
  };
}
export function accentVars(accent: string, bg: string, mode: Mode): Record<string, string> {
  const dark = mode === "dark";
  return { "--accent": accent, "--accent-ink": mix(accent, dark ? "#ffffff" : "#000000", 0.22), "--accent-tint": mix(bg, accent, dark ? 0.2 : 0.13) };
}

/** "Fill in the rest": sidebar, cards, softer text, lines and button text from background, text and accent. */
export function derive(c: Ef, mode: Mode): Ef {
  const dark = mode === "dark", bg = c.bg, t = c.ink;
  return {
    ...c, side: dark ? mix(bg, "#000000", 0.28) : mix(bg, t, 0.04), raise: dark ? mix(bg, t, 0.05) : mix(bg, "#ffffff", 0.7),
    ink2: mix(t, bg, 0.28), ink3: mix(t, bg, 0.5), line: mix(bg, t, 0.12), btn: t, onBtn: contrast(t, "#ffffff") > contrast(t, "#111111") ? "#ffffff" : "#111111",
  };
}

export type Rating = { label: string; ratio: number; word: string; ok: boolean };
/** How readable each pairing is, as the editor shows it. */
export function ratings(c: Ef): Rating[] {
  const r = (label: string, a: string, b: string, need: number): Rating => {
    const ratio = contrast(a, b);
    return { label, ratio, word: ratio >= need + 2.5 ? "Easy to read" : ratio >= need ? "Readable" : "Hard to read", ok: ratio >= need };
  };
  return [r("Text on the background", c.ink, c.bg, 4.5), r("Softer text on the background", c.ink2, c.bg, 4.5), r("Text on cards", c.ink, c.raise, 4.5),
    r("Button text on buttons", c.onBtn, c.btn, 4.5), r("Accent against the background", c.accent, c.bg, 3)];
}

/** The engine's theme palette (ThemePaletteSchema) for one mode, and back. Good and Careful have no engine key. */
export function toPalette(c: Ef): Record<string, string> {
  return {
    background: c.bg, foreground: c.ink, card: c.raise, "card-foreground": c.ink, popover: c.raise, "popover-foreground": c.ink,
    primary: c.btn, "primary-foreground": c.onBtn, secondary: c.side, "secondary-foreground": c.ink2, muted: c.side, "muted-foreground": c.ink3,
    accent: c.accent, "accent-foreground": c.onBtn, destructive: c.bad, "destructive-foreground": c.onBtn, border: c.line, input: c.line, ring: c.accent,
  };
}
export function fromPalette(p: Record<string, unknown> | undefined, mode: Mode, extra?: Partial<Ef>): Ef | undefined {
  if (!p) return undefined;
  const base = SLATE[mode], h = (k: string, fb: string) => (isHex(p[k]) ? (p[k] as string).toLowerCase() : fb);
  return {
    bg: h("background", base.bg), side: h("secondary", base.side), raise: h("card", base.raise), ink: h("foreground", base.ink),
    ink2: h("secondary-foreground", base.ink2), ink3: h("muted-foreground", base.ink3), line: h("border", base.line), accent: h("accent", base.accent),
    btn: h("primary", base.btn), onBtn: h("primary-foreground", base.onBtn), ok: extra?.ok ?? base.ok, warn: extra?.warn ?? base.warn, bad: h("destructive", base.bad),
  };
}

/** A theme definition (themes.get) as a pair, with the Good and Careful colours kept beside it. */
export function pairOfDefinition(def: Record<string, unknown>, extra?: Record<string, unknown>): Pair | undefined {
  const pal = (m: Mode) => (def[m] ?? def[m === "light" ? "dark" : "light"]) as Record<string, unknown> | undefined;
  const x = (m: Mode) => (extra?.[m] ?? undefined) as Partial<Ef> | undefined;
  const light = fromPalette(pal("light"), "light", x("light")), dark = fromPalette(pal("dark"), "dark", x("dark"));
  return light && dark ? { light, dark } : undefined;
}
