// Customize's own line glyphs, drawn like shell/icons.tsx (24 box, stroke 1.7, round caps, currentColor),
// for the preview's tool kinds and surfaces that the shared set does not carry.
import type { ReactNode } from "react";

const PATHS = {
  plug: <path d="M9 3.5v4M15 3.5v4M7 7.5h10v3a5 5 0 0 1-10 0zM12 15.5v5" />,
  bolt: <path d="M13 3.5 6 13h5.5l-1 7.5L18 11h-5.5z" />,
  puzzle: <path d="M10 4.5a2 2 0 0 1 4 0V6h4v4h-1.5a2 2 0 0 0 0 4H18v4h-4v-1.5a2 2 0 0 0-4 0V18H6v-4h1.5a2 2 0 0 0 0-4H6V6h4z" />,
  terminal: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M7.5 10l2.5 2-2.5 2M12.5 14.5h4" /></>,
  people: <><circle cx="9" cy="9" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M15 6.5a3 3 0 0 1 0 5.5M17 14.5a5 5 0 0 1 3.5 4.5" /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
  sparkle: <path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.5 6.5l2.5 2.5M15 15l2.5 2.5M6.5 17.5 9 15M15 9l2.5-2.5" />,
  windows: <><rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" /></>,
  laptop: <><rect x="5" y="6" width="14" height="9.5" rx="1.5" /><path d="M3 18.5h18" /></>,
  phone: <><rect x="7" y="3.5" width="10" height="17" rx="2.5" /><path d="M11 17.5h2" /></>,
  android: <><rect x="6.5" y="9" width="11" height="10.5" rx="2" /><path d="M8.5 9a3.5 3.5 0 0 1 7 0M9 5.5l1 1.5M15 5.5l-1 1.5" /></>,
  chat: <path d="M5 5.5h14v10H10l-4 3.5v-3.5H5z" />,
  code: <path d="M9 8l-4 4 4 4M15 8l4 4-4 4M13 6l-2 12" />,
  globe: <><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4a15 15 0 0 1 0 16 15 15 0 0 1 0-16" /></>,
  folder: <path d="M4 7.5a1.5 1.5 0 0 1 1.5-1.5H10l2 2h6.5A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />,
} satisfies Record<string, ReactNode>;

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, size = 18 }: { name: GlyphName; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon">
      {PATHS[name]}
    </svg>
  );
}
