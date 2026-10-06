// Settings › On this computer (DESIGN-SPEC §4.7.7): this computer's hardware (system.info), what the engine can set
// up here (branch.setup.detect prepareOptions, run as a branch.setup.prepare.start wizard that picks a model for this
// computer and installs it with its own progress), the models already here (models.list, local), the runtimes, and at
// Advanced the rows for running models here. The engine has no model catalogue with sizes or graphics-card readout yet.
import { useState, type ReactNode } from "react";
import type { SettingsPageProps } from "../index";
import { list, text, visible, type RecordValue } from "../adapter";
import { useResource } from "../hooks";
import { Icon } from "../../../shell/icons";
import { Btn, Ctl, Empty, Page, Sec, Status, useScope, type RowEntry } from "../kit";
import { Runtimes, RUNTIMES } from "./local-runtimes";
import { LocalMore, MORE_TITLES } from "./local-more";
import { SetupDialog } from "./local-setup";
import "./set1.css";
import "./local.css";
import { shownWhy } from "../../../shell/shown-why";

const GIB = 1024 ** 3;
export const NO_GPU = "Branch can’t read the graphics card yet.";
const NO_CATALOGUE = "Branch can’t list recommended models with their sizes yet. Each setup above picks one that fits this computer.";

/** This computer, from system.info. Graphics memory isn't reported by the engine. */
export type Hw = { cpu?: string; ramGb?: number; diskGb?: number; mac: boolean; windows: boolean; port?: number };
export function hwOf(info: RecordValue | undefined): Hw {
  const gb = (b: unknown) => (typeof b === "number" && b > 0 ? Math.round(b / GIB) : undefined);
  const platform = text(info?.platform);
  return {
    cpu: typeof info?.cpuModel === "string" && info.cpuModel.trim() ? visible(info.cpuModel.trim()) : undefined,
    ramGb: gb(info?.memoryTotalBytes),
    diskGb: gb(info?.diskAvailableBytes),
    mac: platform === "darwin" && info?.arch === "arm64",
    windows: platform === "win32",
    port: typeof info?.port === "number" ? info.port : undefined,
  };
}

export type Fit = "great" | "ok" | "no";
export const FIT_WORDS: Record<Fit, string> = { great: "Runs great on your graphics card", ok: "Runs, a little slower (uses memory)", no: "Too big for this computer" };
/** Rule 1: within graphics memory runs great; up to 90% of usable memory runs slower; above that it's too big.
 *  Usable memory: all of it on Apple silicon; with a graphics card the larger of its memory and half the memory; else half. */
export function fitOf(bytes: number, hw: { ramGb: number; vramGb?: number; mac: boolean }): Fit {
  const need = bytes / 1e9;
  const vram = hw.mac ? 0 : hw.vramGb ?? 0;
  const usable = hw.mac ? hw.ramGb : vram ? Math.max(vram, hw.ramGb / 2) : hw.ramGb / 2;
  return need <= vram ? "great" : need <= usable * 0.9 ? "ok" : "no";
}

/** Which runtimes the engine found: a detected candidate for it, or a model of it on this computer. */
export function foundRuntimes(detect: RecordValue | undefined, models: RecordValue[]): Set<string> {
  const found = new Set<string>();
  for (const c of list(detect?.candidates)) {
    found.add(text(c.brandId));
    found.add(text(c.modelRef).split("/")[0]);
  }
  for (const m of models) if (m.local === true) found.add(text(m.provider));
  return found;
}

export function LocalPage(props: SettingsPageProps) {
  const scope = useScope();
  const agent = scope ? { agentId: scope } : {};
  const info = useResource<RecordValue>(props.engine, "system.info", {});
  const detect = useResource<RecordValue>(props.engine, "branch.setup.detect", agent);
  const models = useResource<RecordValue>(props.engine, "models.list", { includeDetails: true });
  const [setup, setSetup] = useState<RecordValue | null>(null);
  const hw = hwOf(info.data);
  const local = list(models.data?.models).filter((m) => m.local === true);
  const found = foundRuntimes(detect.data, local);
  const done = () => { setSetup(null); void detect.reload(); void models.reload(); };
  return (
    <Page title={props.title} lede="Models that run here, free and private. Branch looks at this computer first and only offers what fits.">
      <Hardware loading={info.loading} error={info.error} hw={hw} runtimes={detect.loading ? undefined : RUNTIMES.filter((r) => found.has(r.id)).map((r) => r.name)} />
      <Recommended loading={detect.loading || models.loading} options={list(detect.data?.prepareOptions)} local={local} onSetup={setSetup} />
      <Runtimes engine={props.engine} hw={hw} detect={detect} models={models} found={found} />
      <LocalMore engine={props.engine} hw={hw} local={local} />
      {setup ? <SetupDialog engine={props.engine} option={setup} agent={agent} onClose={done} /> : null}
    </Page>
  );
}

const SVG = (d: string) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const CPU = SVG("M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4");
const LAYERS = SVG("M12 3l9 5-9 5-9-5zM3 13l9 5 9-5");
const TERM = SVG("M4 5h16v14H4zM7 9l3 3-3 3M12 15h5");
export const DOWNLOAD = SVG("M12 4v11M7 10l5 5 5-5M5 20h14");

type HwProps = { loading: boolean; error?: string; hw: Hw; runtimes?: string[] };
function Hardware({ loading, error, hw, runtimes }: HwProps) {
  if (loading) return <div className="hw-k scan-k" role="status"><span className="spin-k" /><b>Looking at this computer…</b><small>Memory, graphics card, free space and which runtimes are installed.</small></div>;
  if (error) return <Status tone="bad" title="Branch couldn’t look at this computer">{visible(error)}</Status>;
  const tiles: [ReactNode, string, string | undefined, string?][] = [
    [CPU, "Processor", hw.cpu],
    [LAYERS, "Memory", hw.ramGb ? `${hw.ramGb} GB` : undefined],
    [<Icon key="g" name="monitor" small />, "Graphics", undefined, NO_GPU],
    [<Icon key="f" name="folder" small />, "Free space", hw.diskGb !== undefined ? `${hw.diskGb} GB` : undefined],
    [TERM, "Runtime", runtimes === undefined ? "Looking…" : runtimes.length ? runtimes.join(", ") : "None found"],
  ];
  return (
    <div className="hw-k">
      {tiles.map(([icon, label, value, off]) => (
        <div key={label} className={`hw-c-k${off ? " off-k" : ""}`} title={shownWhy(off)}>
          <span className="ico-tile-k">{icon}</span>
          <span><small>{label}</small><b>{value ?? (off ? "Not read yet" : "Not reported")}</b></span>
        </div>
      ))}
    </div>
  );
}

type RecProps = { loading: boolean; options: RecordValue[]; local: RecordValue[]; onSetup: (o: RecordValue) => void };
function Recommended({ loading, options, local, onSetup }: RecProps) {
  return (
    <Sec title="Recommended for you">
      {options.length || local.length ? (
        <div className="lm-grid-k">
          {local.map((m) => <Installed key={`${text(m.provider)}/${text(m.id)}`} m={m} />)}
          {options.map((o) => (
            <div key={text(o.id)} className="lm-k" data-row={visible(o.label)}>
              <div className="lm-h-k"><b>{visible(o.label)}</b></div>
              {o.hint ? <p>{visible(o.hint)}</p> : null}
              <div className="acts"><Btn pri sm onClick={() => onSetup(o)}>{DOWNLOAD}{visible(o.actionLabel ?? "Set it up")}</Btn></div>
            </div>
          ))}
        </div>
      ) : loading ? <p className="hint">Looking for what this computer can run…</p> : <Empty>Nothing to set up on this computer yet.</Empty>}
      <Ctl title="Recommended models, sized to this computer" sub="Each model with how well it fits here, and a size to pick: small, balanced or full." off={NO_CATALOGUE} />
    </Sec>
  );
}

function Installed({ m }: { m: RecordValue }) {
  const name = visible(m.name ?? m.id);
  const ctx = typeof m.contextWindow === "number" ? Math.round(m.contextWindow / 1000) : 0;
  const runtime = RUNTIMES.find((r) => r.id === m.provider)?.name ?? visible(m.provider);
  return (
    <div className="lm-k" data-row={name}>
      <div className="lm-h-k"><b>{name}</b></div>
      <p>On this computer through {runtime}. Free and private.</p>
      <div className="lm-tags-k">
        {m.supportsTools === true ? <span className="tag-k">tools</span> : null}
        {Array.isArray(m.input) && m.input.includes("image") ? <span className="tag-k">sees pictures</span> : null}
        {ctx ? <span className="tag-k">{ctx}K-token context</span> : null}
      </div>
      <div className="acts">
        <span className="pill done-k"><i />Installed</span>
        <Btn sm disabled title="Open a conversation and pick this model to talk to it.">Say hello</Btn>
        <Btn ghost sm disabled title="Branch can’t remove a model from this computer yet.">Remove</Btn>
      </div>
    </div>
  );
}

const rows = (sec: string, lv: 0 | 1 | 2, titles: string[]): RowEntry[] => titles.map((title) => ({ page: "local", title, sec, lv }));
export const LOCAL_ROWS: RowEntry[] = [
  ...rows("Recommended for you", 0, ["Recommended models, sized to this computer"]),
  ...rows("Runtimes", 0, RUNTIMES.map((r) => r.name)),
  ...rows("Runtimes", 1, ["Share with your other computers"]),
  ...rows("Running models here, more", 1, MORE_TITLES),
];
