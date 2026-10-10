// Settings › Voice shared bits: a resource
// that keeps its last answer while it reloads, and the small choice helpers every Voice section uses.
// TODO(engine-lane): the greyed reasons in this file say what is still missing; shownWhy (shell/shown-why.ts) keeps them out of sight.
import { useRef } from "react";
import type { WindowEngine } from "../../../connect/engine";
import { list, record, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Ctl, Field, Pick, Seg, type Opt } from "../kit";

export const NO_KEY = "Branch has no setting for this yet.";

/** A resource that keeps showing its last answer while it reloads after a save. */
export function useKept<T>(engine: WindowEngine, method: string, params: unknown = {}) {
  const res = useResource<T>(engine, method, params);
  const last = useRef<T | undefined>(undefined);
  if (res.data !== undefined) last.current = res.data;
  return { ...res, data: res.data ?? last.current };
}
export type Kept<T> = ReturnType<typeof useKept<T>>;

export const isMac = (): boolean => typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);

/** A choice that draws as segments when short and as a list when long (an engine's voices can be many). */
export function Choice({ value, options, onChange, label, disabled }: { value: string; options: Opt[]; onChange: (id: string) => void; label: string; disabled?: boolean }) {
  return options.length <= 4
    ? <Seg label={label} value={value} options={options} onChange={onChange} disabled={disabled} />
    : <Pick label={label} value={value} options={options} onChange={onChange} disabled={disabled} />;
}

/** A command a person can run, shown as code (Technical). */
export function CodeRow({ t, code, sub, help }: { t: string; code: string; sub?: string; help?: string }) {
  return <Ctl title={t} sub={sub} help={help}><code className="val-k code-k" tabIndex={0}>{code}</code></Ctl>;
}

/** A number field that saves on commit; blank puts the engine's default back (null). */
export function NumField({ value, unit, label, ph, onSave, min, max, int }: {
  value: unknown; unit?: string; label: string; ph?: string; onSave: (v: number | null) => void; min?: number; max?: number; int?: boolean;
}) {
  const shown = typeof value === "number" ? String(value) : "";
  const commit = (raw: string) => {
    const t = raw.trim();
    if (!t) return onSave(null);
    const n = Number(t);
    if (!Number.isFinite(n) || (int && !Number.isInteger(n)) || (min !== undefined && n < min) || (max !== undefined && n > max)) return undefined;
    onSave(n);
  };
  return <><span className="num-k"><Field label={label} value={shown} placeholder={ph} onCommit={commit} /></span>{unit ? <small className="unit-k">{unit}</small> : null}</>;
}

/** Engine providers ({id, label|name, configured}) as list options. */
export type Provider = { id: string; label: string; configured: boolean; models: string[]; voices: string[]; transports: string[]; defaultModel?: string };
export function providersOf(value: unknown): Provider[] {
  return list(value).map((p) => ({
    id: text(p.id), label: visible(p.label ?? p.name ?? p.id), configured: p.configured === true,
    models: Array.isArray(p.models) ? p.models.map(String) : [],
    voices: Array.isArray(p.voices) ? p.voices.map(String) : [],
    transports: Array.isArray(p.transports) ? p.transports.map(String) : [],
    defaultModel: typeof p.defaultModel === "string" ? p.defaultModel : undefined,
  }));
}
export const group = (catalog: RecordValue | undefined, key: string) => record(catalog?.[key]);
