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
// Branch Slate (default look). Other looks come from appearance-store lookCss(); glass reads only these names.
export const color = {
  light: { bg: "#F6F8F9", side: "#EDF1F3", raise: "#FFFFFF", title: "#E7ECEF", ink: "#141D24", ink2: "#3A4751", ink3: "#5F6C76",
    line: "#E3E9EC", line2: "#D0D9DE", fill: "#ECF0F3", fill2: "#E1E8EC", accent: "#484CE5", accentInk: "#3A3EBA", accentTint: "#E9EFFF",
    btn: "#16212A", onBtn: "#F8FAFB", ok: "#2F8F5B", warn: "#A86E12", bad: "#C2412D", mute: "#5F6B75", leaf: "#4A7040" },
  dark: { bg: "#0F1418", side: "#0B0F12", raise: "#161D22", title: "#080B0D", ink: "#E6ECF0", ink2: "#AEBAC3", ink3: "#85929B",
    line: "#1D262C", line2: "#2B363E", fill: "#182026", fill2: "#212B32", accent: "#6064E4", accentInk: "#B4BBFE", accentTint: "#1E2144",
    btn: "#E8EEF2", onBtn: "#11161A", ok: "#5CC08A", warn: "#E0AF3B", bad: "#F0806C", mute: "#95A2AB", leaf: "#4A7040" },
} as const;
export const glass = {
  light: {
    control: { fill: "rgba(255,255,255,.6)", edge: "rgba(0,0,0,.08)", hi: "rgba(255,255,255,.7)", blur: "blur(20px) saturate(180%)", shadow: "0 6px 18px rgba(0,0,0,.12)", shadowSm: "0 4px 12px rgba(0,0,0,.10)" },
    floating: { fill: "rgba(255,255,255,.62)", edge: "rgba(0,0,0,.07)", hi: "rgba(255,255,255,.95)", blur: "blur(24px) saturate(180%)", shadow: "0 8px 28px rgba(16,24,32,.12)" },
    chip: { fill: "rgba(255,255,255,.55)", on: "rgba(255,255,255,.92)", track: "rgba(118,118,128,.12)" },
  },
  dark: {
    control: { fill: "rgba(30,30,32,.55)", edge: "rgba(255,255,255,.14)", hi: "rgba(255,255,255,.12)", blur: "blur(20px) saturate(180%)", shadow: "0 6px 18px rgba(0,0,0,.12)", shadowSm: "0 4px 12px rgba(0,0,0,.10)" },
    floating: { fill: "rgba(34,38,44,.58)", edge: "rgba(255,255,255,.09)", hi: "rgba(255,255,255,.10)", blur: "blur(24px) saturate(180%)", shadow: "0 10px 32px rgba(0,0,0,.45)" },
    chip: { fill: "rgba(255,255,255,.055)", on: "rgba(255,255,255,.13)", track: "rgba(118,118,128,.24)" },
  },
  // Reduce transparency (either mode): fills become solid, blur off; mix = color-mix(in srgb, ink N%, bg)
  reduce: { controlFill: "bg", floatingFill: "bg", chip: { inkPct: 5 }, on: { inkPct: 10 }, track: { inkPct: 8 }, blur: "none" },
} as const;
export type Spring = keyof typeof spring;
export const cssTransition = (prop: string, s: Spring) => `${prop} ${spring[s].ms}ms ${spring[s].ease}`;
