// Line icons Automations uses that the shared set lacks (24 px grid, 1.6 stroke, as preview 00-core's line icons).
const PATHS = {
  play: <path d="M7 5l12 7-12 7z" />,
  pause: <path d="M9 6v12M15 6v12" />,
  pulse: <path d="M3 12h4l2-5 4 10 2-5h6" />,
  clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  globe: <><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4a15 15 0 0 1 0 16 15 15 0 0 1 0-16" /></>,
  term: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M7.5 10l2.5 2-2.5 2M12.5 14h4" /></>,
  chat: <path d="M5 5.5h14v10H10l-4 3v-3H5z" />,
  mail: <><rect x="3.5" y="6" width="17" height="12" rx="2" /><path d="M4 7l8 6 8-6" /></>,
  star: <path d="M12 4.5l2.3 4.7 5.2.8-3.8 3.6.9 5.1L12 16.3l-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z" />,
  flow: <><rect x="4" y="4" width="7" height="5" rx="1.5" /><rect x="13" y="15" width="7" height="5" rx="1.5" /><path d="M7.5 9v4.5h9V15" /></>,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r=".6" /></>,
  rss: <path d="M5 5a14 14 0 0 1 14 14M5 11a8 8 0 0 1 8 8M6 18h.01" />,
  form: <><rect x="5" y="3.5" width="14" height="17" rx="2" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></>,
  board: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9 4.5v15M15 4.5v15" /></>,
  teach: <path d="M3 9l9-4.5L21 9l-9 4.5zM7 11v4.5c1.5 1.5 3 2 5 2s3.5-.5 5-2V11" />,
  more: <path d="M6 12h.01M12 12h.01M18 12h.01" />,
  x: <path d="M7 7l10 10M17 7L7 17" />,
  plus: <path d="M12 5v14M5 12h14" />,
  down: <path d="M6 9l6 6 6-6" />,
};
export type GlyphName = keyof typeof PATHS;

export function Glyph({ name, size = 16 }: { name: GlyphName; size?: number }) {
  return (
    <svg className="au-glyph" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
