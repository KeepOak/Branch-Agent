// The Settings row kit (DESIGN-SPEC §4.7, §5.3): the preview's designed rows (.sec, .ctl, .sw, segments, .prow lists,
// status boxes) and the save-as-you-change plumbing every page shares. Copied from the App Preview's 00-core,
// 50-settings and 51-set1p styles; each change saves at once and reports to the frame's "Saved" line.
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { WindowEngine } from "../../connect/engine";
import { errorText, record, type RecordValue } from "./adapter";
import { configStore, pathKeys, type ConfigPath } from "./config-store";
import { Icon } from "../../shell/icons";
import { PIN_MAX, type Pins } from "./pins";
import { isDevNote, shownWhy } from "../../shell/shown-why";
import "./kit.css";

/** 0 = Regular, 1 = Advanced, 2 = Technical. */
export type Lv = 0 | 1 | 2;
export type SaveReport = { saving: () => void; saved: () => void; failed: (message: string) => void };
/** ask: starts a conversation with the default Trunk ("Learn more"); absent while no model is set up. */
/** pins: each row's pin and General's Pinned list (absent outside the Settings frame). */
type Kit = { level: Lv; report: SaveReport; scope: string | null; ask?: (text: string) => void; askName?: string; pins?: Pins };
const NOOP: SaveReport = { saving: () => undefined, saved: () => undefined, failed: () => undefined };
const KitContext = createContext<Kit>({ level: 0, report: NOOP, scope: null });

/** The frame provides the level, the save reporter and the "Settings for" Trunk (null = every Trunk / the default). */
export function KitProvider({ children, ...kit }: Kit & { children: ReactNode }) {
  return <KitContext.Provider value={kit}>{children}</KitContext.Provider>;
}
export const useLevel = (): Lv => useContext(KitContext).level;
export const useSaved = (): SaveReport => useContext(KitContext).report;
/** Starts a conversation with the default Trunk with this text; undefined while no model is set up. */
export const useAsk = (): ((text: string) => void) | undefined => useContext(KitContext).ask;
/** The Trunk chosen in "Settings for" (Advanced), or null for the default Trunk. */
export const useScope = (): string | null => useContext(KitContext).scope;
/** The pinned rows, for General's Pinned list. */
export const usePinsKit = (): Pins | undefined => useContext(KitContext).pins;

/** The not-allowed state (§4.7.0): a person who may not change how Branch is set up sees these rows greyed. */
export const NOSETUP = "Only someone who may change how Branch is set up can change this.";
const LockContext = createContext(false);
/** Rows inside lock when the person may not change setup; `personal` sections (their own choices) never lock. */
export function SetupLock({ locked, children }: { locked: boolean; children: ReactNode }) {
  return <LockContext.Provider value={locked}>{children}</LockContext.Provider>;
}

/** Runs a save and reports it: "Saved" for 2 s, or the engine's error on the frame line. Resolves false on failure. */
export function useSaveRunner(): (save: () => Promise<unknown>) => Promise<boolean> {
  const report = useSaved();
  return useCallback(async (save: () => Promise<unknown>) => {
    report.saving();
    try {
      await save();
      report.saved();
      return true;
    } catch (error) {
      report.failed(errorText(error));
      return false;
    }
  }, [report]);
}

/** The engine config for rows: get(path) reads it; set(path, value) saves that one path at once (null = back to default).
 *  Every row on every page shares one store, so saves queue against the latest revision. */
export function useConfig(engine: WindowEngine) {
  const store = configStore(engine);
  const version = useSyncExternalStore((fn) => store.subscribe(fn), () => store.snap, () => store.snap);
  useEffect(() => { if (!store.snap) void store.load(); }, [store]);
  const run = useSaveRunner();
  const cfg: RecordValue = record(version?.config);
  const get = useCallback((path: ConfigPath): unknown => pathKeys(path).reduce<unknown>((v, k) => record(v)[k], cfg), [cfg]);
  const set = useCallback((path: ConfigPath, value: unknown) => run(() => store.set(path, value)), [run, store]);
  return { cfg, get, set, loading: !version && !store.error, error: store.error, invalid: version?.valid === false, reload: () => store.load() };
}

type HelpEntry = { label: string; text: string };
const HelpContext = createContext<((key: string, entry?: HelpEntry) => void) | null>(null);

/** Long explanations are supplied explicitly, never inferred from display copy. */
function useHelpEntry(key: string, label: string, help?: string): void {
  const register = useContext(HelpContext);
  useEffect(() => {
    if (!help || !register) return;
    register(key, { label, text: help });
    return () => register(key);
  }, [help, key, label, register]);
}

/** A page head with one help affordance and the original ask action inside it. */
export function Page({ title, lede, help, children, top }: { title: string; lede: ReactNode; help?: string; children?: ReactNode; top?: ReactNode }) {
  const { ask, askName } = useContext(KitContext);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<Record<string, HelpEntry>>({});
  const helpRef = useRef<HTMLDivElement>(null);
  const [helpPosition, setHelpPosition] = useState({ top: 0, right: 0 });
  const register = useCallback((key: string, entry?: HelpEntry) => {
    setEntries((current) => {
      if (entry && current[key]?.text === entry.text && current[key]?.label === entry.label) return current;
      if (!entry && !current[key]) return current;
      const next = { ...current };
      if (entry) next[key] = entry; else delete next[key];
      return next;
    });
  }, []);
  useEffect(() => {
    const toggle = () => {
      const anchor = document.querySelector<HTMLElement>('[data-testid="ask-default"]');
      if (anchor) {
        const box = anchor.getBoundingClientRect();
        setHelpPosition({ top: box.bottom + 8, right: window.innerWidth - box.right });
      }
      setOpen((value) => !value);
    };
    window.addEventListener("branch-settings-help", toggle);
    return () => window.removeEventListener("branch-settings-help", toggle);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!helpRef.current?.contains(target) && !document.querySelector('[data-testid="ask-default"]')?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); document.querySelector<HTMLButtonElement>('[data-testid="ask-default"]')?.focus(); } };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  return (
    <div className="kit-page" data-page-title={title}>
      {top}
      <div className="kit-head"><h1>{title}</h1><div className="kit-help-anchor" ref={helpRef}>
        {open ? <div className="kit-help-pop" role="dialog" aria-label="Help for this page" style={helpPosition}>
          <b>About {title}</b>
          <div className="kit-help-body">
            {help ? <div><strong>{title}</strong><p>{help}</p></div> : null}
            {Object.values(entries).map((entry) => <div key={`${entry.label}-${entry.text}`}><strong>{entry.label}</strong><p>{entry.text}</p></div>)}
          </div>
          <button type="button" className="kit-help-ask" disabled={!ask} title={ask ? undefined : "Set up a model to ask about this page"} onClick={() => { setOpen(false); ask?.(`Tell me about Settings › ${title}.`); }}>Ask {askName ?? "your Trunk"} about this page</button>
        </div> : null}
      </div></div>
      <p className="lede">{lede}</p>
      <HelpContext.Provider value={register}>{children}</HelpContext.Provider>
    </div>
  );
}

/** A section: sentence-case heading, an optional hint and its rows. */
export function Sec({ title, group, showHeading = true, hint, help, right, children, id, personal }: { title: string; group?: string; showHeading?: boolean; hint?: ReactNode; help?: string; right?: ReactNode; children?: ReactNode; id?: string; personal?: boolean }) {
  const locked = useContext(LockContext);
  const helpKey = useId();
  useHelpEntry(helpKey, title, help);
  const heading = group ?? title;
  if (personal && locked) return <SetupLock locked={false}><Sec title={title} group={group} showHeading={showHeading} hint={hint} help={help} right={right} id={id}>{children}</Sec></SetupLock>;
  return (
    <div className="sec" data-sec={title || undefined} id={id}>
      {showHeading && (title || right) ? <h2 tabIndex={-1}>{heading}{right}</h2> : null}
      {hint ? <p className="hint">{hint}</p> : null}
      {children}
    </div>
  );
}

/** Where an Advanced row's choice lives. */
export type Keep = "device" | "everywhere";
const KEEP_LINE: Record<Keep, string> = { device: "This device only.", everywhere: "Follows you on every device." };

/** A row's pin (UI-DESKTOP-0369): shows on hover or focus, and stays lit while the row is pinned. */
function PinBtn({ title }: { title: string }) {
  const pins = useContext(KitContext).pins;
  if (!pins || title.length > PIN_MAX) return null;
  const on = pins.has(title);
  return (
    <button type="button" className="pin-k" aria-pressed={on} aria-label={`${on ? "Unpin" : "Pin"} ${title}`} title={on ? "Unpin" : "Pin to the top of General"} onClick={() => pins.toggle(title)}>
      <Icon name="pin" small />
    </button>
  );
}

/** One settings row: title, sub-line and the control on the right. `off` greys the control and says why on its own line.
 *  Every row with a plain title has a pin, except General's Pinned list itself (noPin). */
export function Ctl({ title, sub, help, children, off, keep, icon, stack, id, after, noPin }: {
  title: ReactNode; sub?: ReactNode; help?: string; children?: ReactNode; off?: string; keep?: Keep; icon?: ReactNode; stack?: boolean; id?: string; after?: ReactNode; noPin?: boolean;
}) {
  const level = useLevel();
  const helpKey = useId();
  const locked = useContext(LockContext);
  const why = off ?? (locked ? NOSETUP : undefined);
  const name = typeof title === "string" ? title : id;
  const shown = shownWhy(why);
  const line = sub ?? shown;
  useHelpEntry(helpKey, typeof title === "string" ? title : id ?? "Setting", help);
  const kept = keep && level >= 1 ? KEEP_LINE[keep] : null;
  return (
    <div className={`ctl${why ? " off-k" : ""}${stack ? " stack-k" : ""}`} data-row={name} aria-disabled={why ? true : undefined}>
      <b>{icon}{title}</b>
      {typeof title === "string" && !noPin ? <PinBtn title={title} /> : null}
      {children ? <span className="right" inert={why ? true : undefined}>{children}</span> : null}
      {line || kept ? <small>{line}{line && kept ? " " : null}{kept ? <span className="kept-k">{kept}</span> : null}</small> : null}
      {shown && sub ? <small className="why-k">{shown}</small> : null}
      {after}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return <input className="sw" type="checkbox" role="switch" aria-label={label} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />;
}

export type Opt = { id: string; label: string; off?: string };

/** A segmented choice (pressed-style, like the preview's settings rows). */
export function Seg({ value, options, onChange, label, disabled, layout = "segments" }: { value: string; options: Opt[]; onChange: (id: string) => void; label: string; disabled?: boolean; layout?: "segments" | "radio" }) {
  const active = options.find((option) => option.id === value && !option.off)?.id ?? options.find((option) => !option.off)?.id;
  return (
    <span className={layout === "radio" ? "sseg sseg-radio" : "sseg"} role={layout === "radio" ? "radiogroup" : "group"} aria-label={label} onKeyDown={(e) => {
      if (disabled || e.altKey || e.ctrlKey || e.metaKey) return;
      const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const index = buttons.indexOf(e.target as HTMLButtonElement);
      if (index < 0) return;
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      const next = e.key === "Home" ? 0 : e.key === "End" ? buttons.length - 1 : step ? (index + step + buttons.length) % buttons.length : -1;
      if (next < 0) return;
      e.preventDefault();
      buttons[next].focus();
      buttons[next].click();
    }}>
      {options.map((o) => (
        <button key={o.id} type="button" role={layout === "radio" ? "radio" : undefined} aria-checked={layout === "radio" ? o.id === value : undefined} aria-pressed={layout === "radio" ? undefined : o.id === value} disabled={disabled || Boolean(o.off)} tabIndex={o.id === active ? 0 : -1} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End" title={layout === "radio" ? undefined : shownWhy(o.off)} onClick={() => o.id !== value && onChange(o.id)}>
          {layout === "radio" ? <span aria-hidden="true" className="sseg-radio-check">{o.id === value ? "✓" : ""}</span> : null}{o.label}{layout === "radio" && shownWhy(o.off) ? <small>{shownWhy(o.off)}</small> : null}
        </button>
      ))}
    </span>
  );
}

export function Pick({ value, options, onChange, label, disabled }: { value: string; options: Opt[]; onChange: (id: string) => void; label: string; disabled?: boolean }) {
  const known = options.some((o) => o.id === value);
  return (
    <select className="inp" aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {!known && value ? <option value={value}>{value}</option> : null}
      {options.map((o) => <option key={o.id} value={o.id} disabled={Boolean(o.off)}>{o.label}</option>)}
    </select>
  );
}

/** A text or number field that saves on Enter or when it loses focus; Escape puts the saved value back. */
export function Field({ value, onCommit, label, placeholder, type = "text", disabled, wide }: {
  value: string; onCommit: (v: string) => void; label: string; placeholder?: string; type?: "text" | "number"; disabled?: boolean; wide?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => { if (draft !== value) onCommit(draft); };
  return (
    <input className={`inp${wide ? " wide-k" : ""}`} aria-label={label} type={type} value={draft} placeholder={placeholder} disabled={disabled}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") setDraft(value); }} />
  );
}

/** A whole-number field with its unit ("8", "steps"); empty means the engine's own default. Saves on Enter or blur. */
export function Num({ value, onCommit, label, unit, placeholder, min = 0, max, disabled }: {
  value: number | undefined; onCommit: (v: number | null) => void; label: string; unit?: string; placeholder?: string; min?: number; max?: number; disabled?: boolean;
}) {
  const shown = value === undefined ? "" : value.toLocaleString("en-US", { maximumFractionDigits: 6 });
  const [draft, setDraft] = useState(shown);
  useEffect(() => setDraft(shown), [shown]);
  const n = Number(draft.replace(/,/g, ""));
  const bad = draft.trim() !== "" && (!Number.isFinite(n) || n < min || (max !== undefined && n > max));
  const commit = () => { if (bad || draft === shown) return; onCommit(draft.trim() === "" ? null : n); };
  return (
    <span className="num-k">
      <input className="inp" inputMode="numeric" aria-label={label} aria-invalid={bad || undefined} value={draft} placeholder={placeholder} disabled={disabled}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") commit(); else if (e.key === "Escape") setDraft(shown); }} />
      {unit ? <small>{unit}</small> : null}
    </span>
  );
}

/** Page tabs (the preview's .tabs: Connections · Defaults …). */
export function Tabs({ tabs, value, onChange, label }: { tabs: Opt[]; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => <button key={t.id} type="button" role="tab" className="tab" aria-selected={t.id === value} onClick={() => onChange(t.id)}>{t.label}</button>)}
    </div>
  );
}

export type Tone = "ok" | "warn" | "bad" | "idle";
/** The status box at the top of a page: a dot, a bold line and what it means. */
export function Status({ tone = "ok", title, help, children, action }: { tone?: Tone; title: ReactNode; help?: string; children?: ReactNode; action?: ReactNode }) {
  const helpKey = useId();
  useHelpEntry(helpKey, typeof title === "string" ? title : "Status", help);
  return (
    <div className={`status${tone === "bad" ? " bad-k" : ""}`} role="status">
      <span className={`sdot ${tone === "ok" ? "" : tone}`} />
      <div className="grow">
        <b>{title}</b>
        {children ? <p>{children}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** A card of list rows (.rows of .prow). */
export function Plist({ children }: { children: ReactNode }) {
  return <div className="rows">{children}</div>;
}
export function Prow({ icon, title, sub, help, children }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; help?: string; children?: ReactNode }) {
  const helpKey = useId();
  useHelpEntry(helpKey, typeof title === "string" ? title : "Row", help);
  return (
    <div className="prow" data-row={typeof title === "string" ? title : undefined}>
      {icon}
      <span className="grow"><b>{title}</b>{sub ? <small>{sub}</small> : null}</span>
      {children}
    </div>
  );
}

export function Btn({ pri, sm, ghost, className, children, title, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { pri?: boolean; sm?: boolean; ghost?: boolean }) {
  const cls = ["btn", pri ? "pri" : "", sm ? "sm" : "", ghost ? "ghost" : "", className ?? ""].filter(Boolean).join(" ");
  return <button type="button" className={cls} title={shownWhy(title)} {...rest}>{children}</button>;
}
export function Acts({ children }: { children: ReactNode }) {
  return <div className="acts">{children}</div>;
}
/** A status pill; `dot={false}` for the preview's plain pills ("Never, by itself", "Off"). */
export function Pill({ tone = "idle", dot = true, children }: { tone?: "ok" | "warn" | "bad" | "idle" | "work"; dot?: boolean; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{dot ? <i /> : null}{children}</span>;
}
/** A paragraph that is only a developer note (shown-why.ts) is not drawn. */
const noteOnly = (children: ReactNode) => typeof children === "string" && isDevNote(children);
export function Hint({ children }: { children: ReactNode }) {
  return noteOnly(children) ? null : <p className="hint">{children}</p>;
}
export function Empty({ children, ...rest }: { children: ReactNode; "data-row"?: string }) {
  return noteOnly(children) ? null : <p className="empty" {...rest}><Icon name="inbox" size={22} />{children}</p>;
}
/** A plain value on the right of a row (Technical readouts). */
export function Val({ children, code }: { children: ReactNode; code?: boolean }) {
  return code ? <code className="val-k">{children}</code> : <span className="val-k">{children}</span>;
}
/** A link-styled button (Learn more, Back to default, section links). */
export function LinkBtn({ children, title, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className="link-k" title={shownWhy(title)} {...rest}>{children}</button>;
}

/** The row search index: each page module lists its rows (title, section, level) so the frame can find and jump. */
export type RowEntry = { page: string; title: string; sec?: string; group: string; lv: Lv; words?: string };
