// Library building blocks drawn after the preview's place parts (42-placesbp / 93-g3p / 94-g4p): section heads,
// rows in a card, icon tiles, greyed controls with their one-line reason, and the line icons the shell set lacks.
import type { ReactNode } from "react";
import { shownWhy } from "../../shell/shown-why";
import { Icon, type IconName } from "../../shell/icons";

const LIB_PATHS = {
  star: <path d="M12 4.5l2.3 4.7 5.2.8-3.8 3.6.9 5.2-4.6-2.4-4.6 2.4.9-5.2-3.8-3.6 5.2-.8z" />,
  shield: <path d="M12 4l6.5 2.5v5c0 4-2.8 6.9-6.5 8.5-3.7-1.6-6.5-4.5-6.5-8.5v-5z" />,
  file: <><path d="M7 3.5h6.5L18 8v12.5H7z" /><path d="M13 3.5V8h5" /></>,
  sheet: <><rect x="4.5" y="5" width="15" height="14" rx="2" /><path d="M4.5 10h15M10 10v9" /></>,
  diff: <><path d="M8 4v10M5 7h6M13 17h6" /><path d="M16 4.5v6" /></>,
  list: <path d="M8 7h11M8 12h11M8 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01" />,
  map: <><circle cx="6" cy="7" r="2" /><circle cx="18" cy="8" r="2" /><circle cx="12" cy="17" r="2" /><path d="M7.7 8.1l2.9 7.2M16.4 9.4l-3.3 6M8 7.2l8 .6" /></>,
  learn: <path d="M5 6.5h14v9H9l-4 3z" />,
  repeat: <><path d="M5 10a7 7 0 0 1 12-3.5L19 9" /><path d="M19 4.5V9h-4.5M19 14a7 7 0 0 1-12 3.5L5 15" /><path d="M5 19.5V15h4.5" /></>,
  box: <><path d="M4.5 8L12 4l7.5 4v8L12 20l-7.5-4z" /><path d="M4.5 8L12 12l7.5-4M12 12v8" /></>,
  camera: <><rect x="3.5" y="7" width="12" height="10" rx="2" /><path d="M15.5 10.5l5-3v9l-5-3" /></>,
  pulse: <path d="M3.5 12h4l2-5 4 10 2-5h5" />,
  people: <><circle cx="9" cy="9" r="3" /><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5" /><circle cx="17" cy="9.5" r="2.3" /><path d="M16 14.6c2.3 0 4 1.2 4.5 3.9" /></>,
  app: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5M6 6l1.8 1.8M16.2 16.2L18 18M6 18l1.8-1.8M16.2 7.8L18 6" /></>,
  code: <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />,
  download: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />,
  cloud: <path d="M7.5 18.5h9.5a3.5 3.5 0 0 0 .5-7 5.5 5.5 0 0 0-10.6-1.3A4.2 4.2 0 0 0 7.5 18.5z" />,
} satisfies Record<string, ReactNode>;

export type LibIconName = keyof typeof LIB_PATHS | IconName;

/** A line icon from the shell set, or one of the Library's own drawn the same way. */
export function LibIcon({ name, size = 15 }: { name: LibIconName; size?: number }) {
  if (!(name in LIB_PATHS)) return <Icon name={name as IconName} size={size} />;
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon">{LIB_PATHS[name as keyof typeof LIB_PATHS]}</svg>;
}

/** The icon over an empty line, on its tile. */
export function EmptyIcon({ name }: { name: LibIconName }) {
  return <span className="lib-empty-i" aria-hidden="true"><LibIcon name={name} size={22} /></span>;
}

export function IcoTile({ icon }: { icon: LibIconName }) {
  return <span className="lib-tile" aria-hidden="true"><LibIcon name={icon} /></span>;
}

/** A control whose engine method does not exist: drawn greyed, the reason in its title. */
export function Grey({ label, reason, why, ghost, className, full }: { label: ReactNode; reason: string; why?: string; ghost?: boolean; className?: string; full?: boolean }) {
  // `why` is the person-facing reason when `reason` is a developer note that shownWhy hides.
  return <button type="button" className={`btn${full ? "" : " sm"}${ghost ? " ghost" : ""}${className ? " " + className : ""}`} disabled title={why ?? shownWhy(reason)} data-reason={reason}>{label}</button>;
}

/** A switch with no engine setting behind it: greyed, with the reason. */
export function GreySwitch({ label, reason }: { label: string; reason: string }) {
  return <button type="button" role="switch" aria-checked={false} aria-label={label} className="switch" disabled title={shownWhy(reason)} data-reason={reason} />;
}

/** A place section: the small mono heading, an optional hint, then its body. */
export function Section({ title, hint, side, children, testid }: { title: string; hint?: ReactNode; side?: ReactNode; children?: ReactNode; testid?: string }) {
  return <section className="lib-sec" data-testid={testid}>
    <div className="lib-sec-h"><h2>{title}</h2>{side}</div>
    {hint && <p className="lib-hint lib-sec-hint">{hint}</p>}
    {children}
  </section>;
}

/** One row: icon tile, title over a quiet line, then its controls. */
export function Row({ icon, title, line, children, badge }: { icon?: LibIconName; title: ReactNode; line?: ReactNode; children?: ReactNode; badge?: ReactNode }) {
  return <div className="lib-row">
    {badge ?? (icon && <IcoTile icon={icon} />)}
    <span className="lib-grow"><b>{title}</b>{line !== undefined && line !== "" && <small>{line}</small>}</span>
    {children}
  </div>;
}

/** The file-type badge the preview draws before a document (MD, PDF, XLSX…). */
export function TypeBadge({ name }: { name: string }) {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toUpperCase() ?? "FILE";
  return <span className="lib-type" aria-hidden="true">{ext}</span>;
}

/** "today", "yesterday", "Monday", "Sep 2": how the preview dates a row. */
export function when(ms: number | null | undefined, now = Date.now()): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const day = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const diff = Math.round((day(now) - day(ms)) / 86_400_000);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 7) return new Date(ms).toLocaleDateString(undefined, { weekday: "long" });
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function plural(n: number, one: string, many: string) {
  return `${new Intl.NumberFormat().format(n)} ${n === 1 ? one : many}`;
}

/** Runs async work over items with at most `limit` in flight; results keep the items' order. */
export async function mapLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function lane() { while (next < items.length) { const i = next++; out[i] = await work(items[i]); } }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}
