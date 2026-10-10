// People place building blocks drawn as the preview draws them (patches 40-places / 42-placesbp, §4.6.5).
import type { KeyboardEvent, ReactNode } from "react";
import { shownWhy } from "../../shell/shown-why";
import { EmptyLine } from "../../places-nav/PlaceFrame";
import { Icon } from "../../shell/icons";
import { initials, personColour, type Activity } from "./data";

/** Line icons the shell's set lacks, in the same 24 px stroke style. */
const GLYPHS = {
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></>,
  phone: <><rect x="7" y="3" width="10" height="18" rx="2.2" /><path d="M11 18h2" /></>,
  chat: <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" />,
  key: <><circle cx="8" cy="15" r="3.5" /><path d="m10.5 12.5 8-8M15.5 7.5l2.5 2.5M13.5 9.5l2 2" /></>,
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" />,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" /></>,
  branch: <><circle cx="6" cy="5.5" r="2" /><circle cx="6" cy="18.5" r="2" /><circle cx="18" cy="8" r="2" /><path d="M6 7.5v9M18 10c0 4-6 3.5-11 7" /></>,
  play: <path d="m8 5.5 10 6.5-10 6.5v-13Z" />,
  tool: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" /></>,
  pulse: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  desktop: <><rect x="3" y="4.5" width="18" height="12" rx="2" /><path d="M9 20h6M12 16.5V20" /></>,
} as const;
export type GlyphName = keyof typeof GLYPHS;
export function Glyph({ name, size = 15 }: { name: GlyphName; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon">{GLYPHS[name]}</svg>;
}

/** A person's round initial avatar with an optional live dot (Active or Idle, from the engine's presence). */
export function Avatar({ id, name, size, activity, label }: { id: string; name: string; size: number; activity?: Activity | null; label?: string }) {
  return <span className="pp-av" style={{ ["--c" as string]: personColour(id), width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
    {initials(name)}{activity && <i className={`pp-dot ${activity}`} />}
  </span>;
}

export function Empty({ children, icon = <Icon name="users" size={22} /> }: { children: ReactNode; icon?: ReactNode }) {
  return <div className="pp-empty"><EmptyLine icon={<span className="pp-empty-i">{icon}</span>}>{children}</EmptyLine></div>;
}

export function Status({ loading, error, reload }: { loading: boolean; error: string | null; reload?: () => void }) {
  if (loading) return <p role="status" className="pp-hint">Loading…</p>;
  if (!error) return null;
  return <div role="alert" className="pp-error"><p>{error}</p>{reload && <button type="button" className="btn sm" onClick={reload}>Try again</button>}</div>;
}

/** The place's tabs: Left/Right/Home/End move; a count shows in a quieter span after the name. `sub` draws a tab's own row of views under the top tabs. */
export function Tabs<T extends string>({ tabs, value, onChange, label, sub }: { tabs: { id: T; name: string; count?: number }[]; value: T; onChange: (v: T) => void; label: string; sub?: boolean }) {
  const move = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = tabs.length;
    const next = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next].id);
    e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus();
  };
  return <div className={sub ? "pp-tabs sub" : "pp-tabs"} role="tablist" aria-label={label}>
    {tabs.map((t, i) => <button key={t.id} type="button" role="tab" className="pp-tab" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1} onKeyDown={e => move(e, i)} onClick={() => onChange(t.id)}>
      {t.name}{t.count ? <span className="n">{t.count}</span> : null}
    </button>)}
  </div>;
}

/** A segmented choice; `off` greys every option with its one-line reason. */
export function Seg<T extends string>({ label, value, options, onChange, off }: { label: string; value: T | null; options: { id: T; name: string }[]; onChange?: (v: T) => void; off?: string }) {
  const i = options.findIndex(o => o.id === value);
  const key = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step || off || !onChange) return;
    e.preventDefault();
    onChange(options[(Math.max(0, i) + step + options.length) % options.length].id);
  };
  return <span className="pp-seg" role="group" aria-label={label} onKeyDown={key} title={shownWhy(off)}>
    {options.map(o => <button key={o.id} type="button" aria-pressed={o.id === value} disabled={!!off || !onChange} title={shownWhy(off)} onClick={() => onChange?.(o.id)}>{o.name}</button>)}
  </span>;
}

/** A switch; `off` greys it with its reason. */
export function Sw({ label, on, onChange, off }: { label: string; on: boolean; onChange?: (v: boolean) => void; off?: string }) {
  return <button type="button" role="switch" className="pp-sw" aria-checked={on} aria-label={label} disabled={!!off || !onChange} title={shownWhy(off)} onClick={() => onChange?.(!on)} />;
}

/** A settings-style row: title, sub-line, control on the right; a greyed row carries its reason. */
export function Ctl({ title, line, children, off }: { title: string; line: ReactNode; children?: ReactNode; off?: string }) {
  return <div className="pp-ctl" data-off={off ? "" : undefined}>
    <b>{title}</b>{children && <span className="right">{children}</span>}
    <small>{line}{shownWhy(off) && <span className="pp-why"> {shownWhy(off)}</span>}</small>
  </div>;
}

export function Section({ title, children, side }: { title: string; children: ReactNode; side?: ReactNode }) {
  return <section className="pp-sec"><div className="pp-sec-h"><h2>{title}</h2>{side}</div>{children}</section>;
}

/** Copies text, reporting the outcome to the caller. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch (error) { console.error(error); return false; }
}
