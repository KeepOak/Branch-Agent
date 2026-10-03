// Settings › Appearance › Make your own (§4.7.3.2): every colour of both modes, the readability of each pairing as you
// go, and the whole window wearing it while you pick. Saving imports it as your theme and turns it on (themes.import).
import { useEffect, useState } from "react";
import { Dialog } from "../../../shell/Dialog";
import { Btn } from "../kit";
import { derive, EF_KEYS, EF_LABELS, isHex, ratings, varsOf, type Ef, type EfKey, type Mode, type Pair } from "./appearance-look";
import { themeName, type Themes } from "./appearance-themes";

export const ACCENTS = ["#484ce5", "#e0a526", "#2f8f5b", "#2f8c86", "#4f6fa8", "#8a5aa8", "#c0467a", "#16212a"];
export type EditStart = { id?: string; name: string; base: string; pair: Pair };
type Props = {
  start: EditStart; themes: Themes; mode: Mode; trunks: string[];
  onPreview: (p: Pair | undefined) => void; onSave: (name: string, pair: Pair, id?: string) => Promise<boolean>; onClose: () => void;
};

export function ThemeEditor({ start, themes, mode, trunks, onPreview, onSave, onClose }: Props) {
  const [name, setName] = useState(start.name);
  const [base, setBase] = useState(start.base);
  const [edit, setEdit] = useState<Mode>(mode);
  const [pair, setPair] = useState<Pair>(start.pair);
  useEffect(() => { onPreview(pair); }, [pair, onPreview]);
  useEffect(() => () => onPreview(undefined), [onPreview]);
  const c = pair[edit];
  const put = (k: EfKey, v: string) => { if (isHex(v)) setPair((p) => ({ ...p, [edit]: { ...p[edit], [k]: v.toLowerCase() } })); };
  const from = (id: string) => { setBase(id); const p = themes.pairOf(id); if (p) setPair({ light: { ...p.light }, dark: { ...p.dark } }); };
  const save = async () => { if (await onSave(name.trim().slice(0, 40) || "My theme", pair, start.id)) onClose(); };
  const foot = <><Btn ghost onClick={onClose}>Cancel</Btn><Btn pri onClick={() => void save()}>{start.id ? "Save changes" : "Save theme"}</Btn></>;
  return (
    <Dialog title={start.id ? `Edit ${start.name}` : "Make your own theme"} wide onClose={onClose} footer={foot}>
      <div className="ced ap-k">
        <div className="ced-l">
          <label className="fld"><span>Name</span><input className="inp" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
          <label className="fld"><span>Start from</span>
            <select className="inp" value={base} onChange={(e) => from(e.target.value)}>
              {themes.list.filter((t) => themes.pairOf(t.id)).map((t) => <option key={t.id} value={t.id}>{themeName(t)}</option>)}
            </select>
          </label>
          <div className="fld"><span>You are colouring</span>
            <span className="sseg" role="group" aria-label="Which mode you are colouring">{([["light", "Daylight"], ["dark", "Moonlight"]] as const).map(([v, l]) => <button key={v} type="button" aria-pressed={edit === v} onClick={() => setEdit(v)}>{l}</button>)}</span>
          </div>
          <div className="fld"><span>Accent</span>
            <span className="accs">{ACCENTS.map((a) => <button key={a} type="button" className="acc" style={{ ["--c" as string]: a }} aria-label={`Accent ${a}`} aria-pressed={c.accent === a} onClick={() => put("accent", a)} />)}</span>
          </div>
          <div className="crows">{EF_KEYS.map((k) => <ColourRow key={`${edit}-${k}`} k={k} v={c[k]} onPut={put} />)}</div>
          <Btn sm onClick={() => setPair((p) => ({ ...p, [edit]: derive(p[edit], edit) }))}>Fill in the rest from background, text and accent</Btn>
        </div>
        <div className="ced-r">
          <p className="hint">Changes show on the whole window as you pick. Each theme has a Daylight and a Moonlight side; colour both, or leave the other as it came.</p>
          <Preview c={c} mode={edit} trunks={trunks} />
        </div>
      </div>
    </Dialog>
  );
}

function ColourRow({ k, v, onPut }: { k: EfKey; v: string; onPut: (k: EfKey, v: string) => void }) {
  const [hex, setHex] = useState(v.toUpperCase());
  useEffect(() => setHex(v.toUpperCase()), [v]);
  return (
    <label className="crow">
      <input type="color" value={v} aria-label={EF_LABELS[k]} onChange={(e) => onPut(k, e.target.value)} />
      <span>{EF_LABELS[k]}</span>
      <input className="inp hexin" value={hex} maxLength={7} spellCheck={false} aria-label={`${EF_LABELS[k]} as a hex code`} aria-invalid={!isHex(hex)}
        onChange={(e) => { setHex(e.target.value); onPut(k, e.target.value); }} />
    </label>
  );
}

/** A small window in the colours being picked, and how readable each pairing is. */
function Preview({ c, mode, trunks }: { c: Ef; mode: Mode; trunks: string[] }) {
  const names = trunks.length ? trunks.slice(0, 3) : [""];
  return (
    <>
      <div className="cprev" style={varsOf(c, mode)}>
        <div className="cp-side"><b>Branch</b>{names.map((n, i) => <span key={`${n}-${i}`} className={`cp-row${i === 0 ? " cp-on" : ""}`}><i />{n}{i === 0 ? <em /> : null}</span>)}</div>
        <div className="cp-main">
          <span className="cp-u">A message you sent</span>
          <span className="cp-b">The Trunk’s answer reads like this.</span>
          <span className="cp-ask"><b>A question for you</b><small>Needs you</small><span><u>Yes</u><s>No</s></span></span>
          <span className="cp-chips"><i className="c-ok">Done</i><i className="c-warn">Estimate</i><i className="c-bad">Stopped</i></span>
        </div>
      </div>
      <div className="ratings">{ratings(c).map((r) => <div key={r.label} className={`rate${r.ok ? "" : " poor"}`}><span>{r.label}</span><b>{r.ratio.toFixed(1)}:1</b><small>{r.word}</small></div>)}</div>
    </>
  );
}
