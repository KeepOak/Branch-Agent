// Customize › Trunks › "Defaults for every Trunk" (Technical; preview 31-trunksp trunkDefaultsPC18): agents.defaults
// cwd, workspace, bootstrapMaxChars, bootstrapTotalMaxChars, userTimezone and imageMaxDimensionPx, each saved on change.
import { useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import { notify } from "../../shell/notify";
import { canWrite, useLoad, WRITE_WHY } from "./data";
import { ENGINE_DEFAULTS, NUMBER_KEYS, readDefaults, type DefaultKey } from "./may";
import { errorText, patchConfig, readConfig } from "./model";
import "./trunk.css";

const ROWS: { k: DefaultKey; title: string; hint?: string; unit?: string; placeholder?: string }[] = [
  { k: "cwd", title: "Working folder", hint: "Where commands and code run. Instructions and memory stay in each Trunk’s own folder.", placeholder: "Each Trunk’s own folder" },
  { k: "workspace", title: "Trunks’ own folders", hint: "Where new Trunks keep their instructions and memory.", placeholder: "The engine’s own folder" },
  { k: "bootstrapMaxChars", title: "Longest instruction file", unit: "characters" },
  { k: "bootstrapTotalMaxChars", title: "All instruction files together", unit: "characters" },
  { k: "userTimezone", title: "Time zone", hint: "For dates in messages and schedules." },
  { k: "imageMaxDimensionPx", title: "Largest picture side", unit: "px" },
];

function zones(current: string): string[] {
  const host = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [host, "UTC"];
  return [...new Set([current, host, "UTC", ...all].filter(Boolean))];
}

export function TrunkDefaults({ engine }: { engine: WindowEngine }) {
  const data = useLoad(async () => readConfig(await engine.request("config.get", {})), "defaults");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const values = data.data ? readDefaults(data.data) : null, write = canWrite(engine);
  const save = async (row: (typeof ROWS)[number], raw: string) => {
    const v = raw.trim();
    if (!data.data || !values || v === values[row.k]) return;
    if (NUMBER_KEYS.includes(row.k) && v && !/^[1-9]\d*$/.test(v)) { setError(`${row.title}: enter a whole number, or leave it empty.`); return; }
    setBusy(true); setError(null);
    try { await patchConfig(engine, data.data, { [`agents.defaults.${row.k}`]: v === "" ? null : NUMBER_KEYS.includes(row.k) ? Number(v) : v }); notify(`${row.title} saved.`); data.reload(); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); }
  };
  return (
    <section className="tk-sec tk-defaults">
      <h3 className="tk-h">Defaults for every Trunk</h3>
      <p className="tk-hint">A Trunk’s own value, set in its editor at Technical, wins over these.</p>
      {data.error && <p className="tk-error" role="alert">{data.error}</p>}
      {values && <div className="tk-rows">{ROWS.map((row) => (
        <div className="tk-ctl" key={row.k}>
          <b>{row.title}</b>
          <span className="tk-right">
            {row.k === "userTimezone"
              ? <select className="inp" aria-label={row.title} value={values[row.k] || zones("")[0]} disabled={busy || !write} title={write ? undefined : WRITE_WHY} onChange={(e) => void save(row, e.target.value)}>{zones(values[row.k]).map((z) => <option key={z}>{z}</option>)}</select>
              : <input key={values[row.k]} className={row.unit ? "inp num" : "inp"} aria-label={row.title} defaultValue={values[row.k]} placeholder={row.placeholder ?? ENGINE_DEFAULTS[row.k]} inputMode={row.unit ? "numeric" : undefined} spellCheck={false} disabled={busy || !write} title={write ? undefined : WRITE_WHY}
                  onBlur={(e) => void save(row, e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void save(row, e.currentTarget.value); }} />}
            {row.unit && <small>{row.unit}</small>}
          </span>
          {row.hint && <small>{row.hint}</small>}
        </div>
      ))}</div>}
      {error && <p className="tk-error" role="alert">{error}</p>}
    </section>
  );
}
