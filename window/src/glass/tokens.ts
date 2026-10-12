import source from "../theme/tokens.css?raw";

export const spring = {
  thumb: { ms: 450, ease: "cubic-bezier(.3,1.35,.5,1)" },
  pop: { ms: 320, ease: "cubic-bezier(.3,1.5,.5,1)" },
  press: { ms: 250, ease: "cubic-bezier(.3,1.4,.5,1)" },
  panel: { ms: 380, ease: "cubic-bezier(.3,1.3,.5,1)" },
  fly: { ms: 260, ease: "cubic-bezier(.3,1.3,.5,1)" },
  search: { ms: 460, ease: "cubic-bezier(.32,1.25,.5,1)" },
  exit: { ms: 440, ease: "cubic-bezier(.5,-0.4,.7,.4)" },
  fade: { ms: 150, ease: "ease" },
} as const;
export const layout = { sideW: 292, railW: 68, topicsW: 300, hdr: 52, hdrNarrow: 58, ctlH: 36, capsuleH: 32, composerH: 54, narrow: 760, tight: 520, popInset: 8 } as const;
export const radius = { pill: 999, composer: 22, card: 16, menu: 14, row: 12, menuRow: 10, seg: 10, thumb: 8 } as const;
export const fade = { chatTop: 72, chatBot: 28, panelTop: 64, panelBot: 24, topicsTop: 24 } as const;
// CSS is the single palette source; JS consumers read its default Slate blocks.
function declarations(blocks: string[]) {
  return Object.fromEntries(blocks.flatMap(block => [...block.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);?/g)].map(match => [match[1], match[2].trim()])));
}
const light = declarations([...source.matchAll(/:root\s*\{([^}]+)\}/g)].map(match => match[1]));
const dark = { ...light, ...declarations([...source.matchAll(/:root\[data-theme="dark"\]\s*\{([^}]+)\}/g)].map(match => match[1])) };
const palette = (vars: Record<string, string>) => ({
  bg: vars["--bg"], side: vars["--side"], raise: vars["--raise"], title: vars["--title"], ink: vars["--ink"], ink2: vars["--ink-2"], ink3: vars["--ink-3"],
  line: vars["--line"], line2: vars["--line-2"], fill: vars["--fill"], fill2: vars["--fill-2"], accent: vars["--accent"], accentInk: vars["--accent-ink"], accentTint: vars["--accent-tint"],
  btn: vars["--btn"], onBtn: vars["--on-btn"], ok: vars["--ok"], warn: vars["--warn"], bad: vars["--bad"], mute: vars["--mute17c"], leaf: vars["--leaf"],
});
export const color = { light: palette(light), dark: palette(dark) };
const surfaces = (vars: Record<string, string>) => ({
  control: { fill: vars["--gc-fill"], edge: vars["--gc-edge"], hi: vars["--gc-hi"], blur: vars["--gc-blur"], shadow: vars["--gc-sh"], shadowSm: vars["--gc-sh-sm"] },
  floating: { fill: vars["--gf-fill"], edge: vars["--gf-edge"], hi: vars["--gf-hi"], blur: vars["--gf-blur"], shadow: vars["--gf-sh"] },
  chip: { fill: vars["--gk-chip"], on: vars["--gk-on"], track: vars["--gk-track"] },
});
export const glass = {
  light: surfaces(light), dark: surfaces(dark),
  reduce: { controlFill: "bg", floatingFill: "bg", chip: { inkPct: 5 }, on: { inkPct: 10 }, track: { inkPct: 8 }, blur: "none" },
} as const;
export type Spring = keyof typeof spring;
export const cssTransition = (prop: string, s: Spring) => `${prop} ${spring[s].ms}ms ${spring[s].ease}`;
