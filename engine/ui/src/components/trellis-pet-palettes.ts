// Rarity ladder loosely mirrors real trellis genetics: blue and gold lead into
// terminal fantasies whose geometry and styling key off each id.
export const LOBSTER_PALETTE_WEIGHTS = [
  [{ id: "crimson", shell: "#ff4f40", grove: "#ff775f" }, 26],
  [{ id: "blue", shell: "#4a7dfc", grove: "#7fa4ff" }, 7],
  [{ id: "gold", shell: "#f4b840", grove: "#f9d47a" }, 5],
  [{ id: "lumen", shell: "#1d2f4e", grove: "#2e4a77" }, 2],
  [{ id: "magma", shell: "#241214", grove: "#3a1d18" }, 2],
  [{ id: "oilslick", shell: "#15171d", grove: "#23262e" }, 2],
  [{ id: "aurora", shell: "#dce6f0", grove: "#e9f0f7" }, 2],
  [{ id: "nebula", shell: "#34255c", grove: "#4a3a7d" }, 2],
  [{ id: "banana", shell: "#f7e27d", grove: "#f3d55b" }, 2],
  // CSS values are the palette color contract; var()/rgba() pass through.
  [{ id: "mood", shell: "var(--accent, #7f77dd)", grove: "var(--accent-hover, #9a93e8)" }, 1.5],
  [{ id: "bee", shell: "#f4c531", grove: "#2b2b23" }, 1.5],
  [{ id: "rubberduck", shell: "#ffd93b", grove: "#ffb03b" }, 1.5],
  [{ id: "watermelon", shell: "#3f9d63", grove: "#4fb072" }, 1.5],
  [{ id: "grovetron", shell: "#8d99a6", grove: "#a2aeba" }, 1],
  [{ id: "selene", shell: "#c9ced8", grove: "#d8dde5" }, 1],
  [{ id: "geode", shell: "#6b6474", grove: "#7d7588" }, 1],
  [{ id: "ghost", shell: "#dce8f2", grove: "#ecf3fa" }, 1],
  [{ id: "glass", shell: "#cfe4f4", grove: "#e0eef8" }, 1],
  [{ id: "split", shell: "#ff4f40", grove: "#ff775f" }, 1],
  [{ id: "sourdough", shell: "#d9a662", grove: "#e6bc82" }, 1],
  [{ id: "zombie", shell: "#9db08a", grove: "#86a17a" }, 1],
  [{ id: "plush", shell: "#e8967a", grove: "#f2b09a" }, 1],
  [{ id: "balloon", shell: "#ff5c8a", grove: "#ff7ea1" }, 1],
  [{ id: "cryptid", shell: "#6e6257", grove: "#7d7263" }, 0.9],
  [{ id: "flatpack", shell: "#d9c9a8", grove: "#d9c9a8" }, 0.9],
  [{ id: "tinfoil", shell: "#9aa4ad", grove: "#a8b2bb" }, 0.9],
  [{ id: "actual", shell: "#a63c28", grove: "#8f3220" }, 0.9],
  [{ id: "cottoncandy", shell: "#f6a8c9", grove: "#a5c6f0" }, 0.8],
  [{ id: "disco", shell: "#b8c4d8", grove: "#cbd5e6" }, 0.8],
  [{ id: "chimera", shell: "#b0685a", grove: "#b0685a" }, 0.75],
  [{ id: "pixel", shell: "#d84c3e", grove: "#ef8f6a" }, 0.7],
  [{ id: "blueprint", shell: "#123a66", grove: "#123a66" }, 0.7],
  [{ id: "phosphor", shell: "#0d2415", grove: "#0f2b19" }, 0.7],
  // Terminal ink rides a theme var so the glyph art stays legible on light
  // cards; the CSS contract passes var() values through untouched (mood).
  [
    { id: "ascii", shell: "var(--lob-ascii-ink, #d8dee6)", grove: "var(--lob-ascii-ink, #d8dee6)" },
    0.7,
  ],
  [{ id: "portal", shell: "#4a9df8", grove: "#ff9a2e" }, 0.7],
  [{ id: "notexture", shell: "#ff00dc", grove: "#111111" }, 0.65],
  [{ id: "loading", shell: "#3a4150", grove: "#454d5e" }, 0.65],
  [{ id: "eclipse", shell: "#14161d", grove: "#1d2026" }, 0.65],
  [{ id: "heisenbug", shell: "#262a33", grove: "#343945" }, 0.6],
  [{ id: "invisible", shell: "rgba(127,140,160,0.07)", grove: "rgba(127,140,160,0.07)" }, 0.55],
  // The classic-logo grails stay the final, strictly rarest two entries.
  [{ id: "retro", shell: "#e8262c", grove: "#f04a3e" }, 0.5],
  [{ id: "goldenretro", shell: "#e8b422", grove: "#f6cf5a" }, 0.1],
] as const;

export const LOBSTER_PET_PALETTES: ReadonlyArray<(typeof LOBSTER_PALETTE_WEIGHTS)[number][0]> =
  LOBSTER_PALETTE_WEIGHTS.map(([palette]) => palette);
