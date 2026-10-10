// The thread's line icons (DESIGN-SPEC §2.9): one stroke set on a 24 × 24 box, stroke 1.7, round caps, no fill.
import type { ReactNode } from "react";
import type { StepKind } from "./format";

export const ICONS = {
  copy: "M9 9h10v10H9zM5 15V5h10",
  retry: "M4 12a8 8 0 0 1 14-5.3M20 4v5h-5M20 12a8 8 0 0 1-14 5.3M4 20v-5h5",
  reply: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v4",
  react: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2M9 9.5h.01M15 9.5h.01",
  eye: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  branch: "M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  pin: "M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  check: "M5 12.5l4.5 4.5L19 7.5",
  x: "M7 7l10 10M17 7L7 17",
  chev: "M9 6l6 6-6 6",
  down: "M12 5v14M5 12l7 7 7-7",
  spin: "M12 3a9 9 0 1 0 9 9",
  warn: "M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  wrap: "M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M15 16l-2 2 2 2M4 18h5",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  clip: "M21 11.5l-8.6 8.6a5 5 0 0 1-7.1-7.1l8.6-8.6a3.5 3.5 0 0 1 5 5l-8.6 8.6a2 2 0 0 1-2.8-2.8l7.9-7.9",
  play: "M7 5l12 7-12 7z",
  pause: "M8 5v14M16 5v14",
  spark: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
} as const;

export function Icon({ d, size = 14, className }: { d: string; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/** Preview STEP_IC_PB18 paths (spec-v23 ~18608–18611, 18834). */
export const STEP_KIND_MARKUP: Record<StepKind, ReactNode> = {
  read: (
    <>
      <path d="M7 3.5h7l4 4V20.5H7z" />
      <path d="M14 3.5v4h4M9.5 12h6M9.5 15.5h6" />
    </>
  ),
  edit: <path d={ICONS.edit} />,
  run: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M7.5 10l2.5 2-2.5 2M12.5 15h4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </>
  ),
  fetch: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.7 2.5 14.3 0 17M12 3.5c-2.5 2.7-2.5 14.3 0 17" />
    </>
  ),
};

/** Kind icon on a step row. Unknown kinds use the preview's check fallback. */
export function StepKindIcon({ kind, size = 14, className }: { kind?: StepKind; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-testid="step-icon"
      data-kind={kind ?? "check"}
    >
      {kind ? STEP_KIND_MARKUP[kind] : <path d={ICONS.check} />}
    </svg>
  );
}
