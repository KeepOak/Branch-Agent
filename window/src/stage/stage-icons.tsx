// The stage's line icons: the App Preview's own paths (prototype `P` table and its patches), 24×24, stroke 1.7,
// round caps, currentColor. Kept beside the stage so the shared shell icon set stays the frame's.
import type { ReactNode } from "react";

const PATHS = {
  layers: <><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>,
  shield: <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z" />,
  cloud: <path d="M7 18.5h10a4 4 0 0 0 .6-8A5.5 5.5 0 0 0 7 9.2 4.7 4.7 0 0 0 7 18.5z" />,
  monitor: <><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M9 20h6M12 16.5V20" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" /></>,
  panel: <><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M15 4.5v15" /></>,
  window: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 9h17" /><path d="M6.5 7h.01M9 7h.01" /></>,
  pip: <><rect x="3" y="4.5" width="18" height="15" rx="2" /><rect x="12" y="12" width="6.5" height="5" rx="1" /></>,
  more: <><circle cx="6" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="18" cy="12" r="1" /></>,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  spark: <path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M6 18l3-3M15 9l3-3" />,
  spin: <path d="M12 3a9 9 0 1 0 9 9" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.5v.1" /></>,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  chev: <path d="M9 6l6 6-6 6" />,
  down: <path d="M6 9l6 6 6-6" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  record: <circle cx="12" cy="12" r="6.5" />,
  hash: <path d="M9 4L7.5 20M16.5 4L15 20M4.5 9h15.5M4 15h15.5" />,
  retry: <path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5" />,
  reload: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3L19.5 9M19.5 4v5h-5" />,
  forward: <path d="M9 6l6 6-6 6" />,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></>,
  edit: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  comment: <path d="M4 5.5h16v10H9l-5 4z" />,
  doc: <><path d="M6 3.5h8l4 4V20.5H6z" /><path d="M14 3.5V8h4M9 12.5h6M9 16h6" /></>,
  folder: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z" />,
  term: <><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4" /></>,
  tools: <path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17v3h3l5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-.5-.5-2.5z" />,
  play: <path d="M7 5l12 7-12 7z" />,
  first: <path d="M7 6v12M17 6l-7 6 7 6" />,
  last: <path d="M17 6v12M7 6l7 6-7 6" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.5" /></>,
  branch: <><circle cx="6" cy="5.5" r="2" /><circle cx="6" cy="18.5" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7.5v9M18 10c0 4-6 3.5-10.5 7" /></>,
  expand: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  minimize: <path d="M5 12h14" />,
  layout: <><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="M12 4.5v15" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4-4" /></>,
  file: <><path d="M6 3.5h8l4 4V20.5H6z" /><path d="M14 3.5V8h4" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12.5l8-8M16 7.5l2.5 2.5" /></>,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  pause: <path d="M9 5.5v13M15 5.5v13" />,
  undo: <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>,
} satisfies Record<string, ReactNode>;

export type StageIconName = keyof typeof PATHS;

export function SIcon({ name, small, className }: { name: StageIconName; small?: boolean; className?: string }) {
  const px = small ? 15 : 18;
  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className ? `icon ${className}` : "icon"}
    >
      {PATHS[name]}
    </svg>
  );
}
