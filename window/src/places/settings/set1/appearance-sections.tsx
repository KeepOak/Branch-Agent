// Settings › Appearance: the plain rows and the sections after Theme (§4.7.3): Agents, Background and its painted
// scenes, Reading, the pet, What's shown, Language, Tray, the second Reading section and Window. Each change saves at
// once to the person's look (appearance-store); rows only the desktop app can do are greyed with the reason.
import { Fragment, useEffect, useState } from "react";
import { Btn, Ctl, Pick, Sec, Seg, Switch, useLevel, useSaveRunner, type Opt } from "../kit";
import { DESKTOP, READING_MORE, rowOf, rowsOf, type RowSpec } from "./appearance-rows";
import type { useLook } from "./appearance-store";

export type Look = ReturnType<typeof useLook>;

/** One row from the table: its switch, segments or list, saved at once (back to the default removes the choice). */
export function SpecRow({ r, look, disabled }: { r: RowSpec; look: Look; disabled?: boolean }) {
  const level = useLevel();
  const save = useSaveRunner();
  if ((r.lv ?? 0) > level) return null;
  const v = r.off ? r.def : look.val(r.key, r.def);
  const set = (x: unknown) => void save(() => look.store.set(r.key, x === r.def ? null : x));
  const off = Boolean(r.off) || disabled;
  return (
    <Ctl title={r.title} sub={r.sub} keep={r.keep} off={r.off}>
      {r.kind === "sw" ? <Switch checked={v === true} label={r.title} disabled={off} onChange={set} /> : null}
      {r.kind === "seg" ? <Seg value={String(v)} options={r.opts ?? []} label={r.title} disabled={off} onChange={set} /> : null}
      {r.kind === "pick" ? <Pick value={String(v)} options={r.opts ?? []} label={r.title} disabled={off} onChange={set} /> : null}
    </Ctl>
  );
}

export function AgentsSec({ look }: { look: Look }) {
  const save = useSaveRunner();
  const shown = look.val("agentShown", shellShown()) === true;
  return (
    <Sec title="Agents">
      <Ctl title="Show the agent beside the conversation" sub="It acts out what the Trunk is doing: thinking, searching, reading, working, waiting for you, celebrating, resting.">
        <Switch checked={shown} label="Show the agent beside the conversation" onChange={(on) => void save(() => look.store.set("agentShown", on))} />
      </Ctl>
      <SpecRow r={rowOf("agentSize")} look={look} />
    </Sec>
  );
}
function shellShown(): boolean {
  try {
    return localStorage.getItem("branch.characterShown") !== "0";
  } catch {
    return true; // storage blocked: the shell shows it
  }
}

const GROVE: [string, string, string | null][] = [["auto", "By the season", null], ["spring", "Spring grove", "/assets/grove-spring.webp"], ["autumn", "Autumn grove", "/assets/grove-autumn.webp"], ["winter", "Winter grove", "/assets/grove-winter.webp"], ["night", "Firefly night", "/assets/grove-night.webp"]];
const PAINTED: [string, string][] = [["summer", "Summer Meadow"], ["rain", "Rainy Forest"], ["lake", "Mountain Lake"], ["blossom", "Blossoming Grove"], ["canyon", "Desert Canyon"], ["snownight", "Snowy Night"], ["bamboo", "Bamboo Grove"], ["hills", "Sunflower Hills"]];
const QUIET: [string, string, string][] = [["night17-lake", "Still lake at night", "lake-night"], ["night17-highland", "Moonlit highland", "highland-moon"], ["day17-sea", "Morning sea", "sea-morning"], ["day17-meadow", "Meadow afternoon", "meadow-afternoon"], ["glow17-amber", "Amber glass", "glow-amber"], ["season17-snow", "First snow", "first-snow"]];
/** The painted scenes: id, name, picture (none for "By the season", which shows the four groves), and whether it is new. */
export const SCENES: { id: string; name: string; file: string | null; fresh?: boolean }[] = [
  ...GROVE.map(([id, name, file]) => ({ id, name, file })),
  ...PAINTED.map(([id, name]) => ({ id, name, file: `/assets/bg/grove-${id}.webp` })),
  ...QUIET.map(([id, name, f]) => ({ id, name, file: `/assets/art17/bg/${f}.webp`, fresh: true })),
];

export function BackgroundSec({ look }: { look: Look }) {
  const save = useSaveRunner();
  const bg = String(look.val("bg", "none")), scene = String(look.val("scene", "auto"));
  const pick = (id: string) => void save(async () => { await look.store.set("scene", id === "auto" ? null : id); await look.store.set("bg", "painted"); });
  return (
    <Sec title="Background">
      <SpecRow r={rowOf("bg")} look={look} />
      {bg === "grove" ? <SpecRow r={rowOf("season")} look={look} /> : null}
      <div className="fld ap-k" data-row="Painted scenes"><span>Painted scenes</span>
        <div className="scenes12">
          {SCENES.map((s) => (
            <button key={s.id} type="button" className={`scene-c12${s.fresh ? " new17e" : ""}`} aria-pressed={bg === "painted" && scene === s.id} onClick={() => pick(s.id)}>
              {s.file ? <span className="sc-img12" style={{ backgroundImage: `url('${s.file}')` }} /> : <span className="sc-img12 sc-auto12">{GROVE.slice(1).map(([id, , f]) => <i key={id} style={{ backgroundImage: `url('${f}')` }} />)}</span>}
              <b>{s.name}</b>
            </button>
          ))}
        </div>
      </div>
      <RangeRow look={look} k="scrim" def={35} max={90} title="How much the theme covers it" label="How much the theme covers the background" sub="More keeps text calmer; less shows more of the background." off={bg === "none"} />
      <RangeRow look={look} k="see" def={25} max={60} title="See-through panels" label="See-through panels" sub="Panels blur what’s behind them." off={bg === "none"} />
      <Ctl title="Preview" sub="Clear the view: see the background. Click anywhere or press Escape to come back." off={bg === "none" ? undefined : "The window doesn’t draw a background yet, so there’s nothing behind it to see."}>
        <Btn sm disabled>{EYE}See it clearly</Btn>
      </Ctl>
    </Sec>
  );
}
const EYE = <svg className="i s" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>;

function RangeRow({ look, k, def, max, title, label, sub, off }: { look: Look; k: string; def: number; max: number; title: string; label: string; sub: string; off: boolean }) {
  const save = useSaveRunner();
  const saved = Number(look.val(k, def));
  const [v, setV] = useState(saved);
  useEffect(() => setV(saved), [saved]);
  const commit = () => { if (v !== saved) void save(() => look.store.set(k, v === def ? null : v)); };
  return (
    <Ctl title={title} sub={sub} keep="everywhere">
      <input className="range" type="range" min={0} max={max} step={5} value={v} aria-label={label} disabled={off}
        onChange={(e) => setV(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <span className="pct-k">{v}%</span>
    </Ctl>
  );
}

export const FONTS: Opt[] = [["theme", "The theme’s own"], ["geist", "Geist"], ["instrument-sans", "Instrument Sans"], ["dm-sans", "DM Sans"], ["ibm-plex-sans", "IBM Plex Sans"], ["space-grotesk", "Space Grotesk"],
  ["atkinson-hyperlegible", "Atkinson Hyperlegible · Distinct shapes for easy reading"], ["fraunces", "Fraunces"], ["lora", "Lora"], ["jetbrains-mono", "JetBrains Mono"], ["system", "System · No web font"]].map(([id, label]) => ({ id, label }));

export function ReadingSec({ look }: { look: Look }) {
  const level = useLevel();
  const save = useSaveRunner();
  const font = (k: "fontUi" | "fontChat") => String(look.val(k, "theme"));
  const set = (k: "fontUi" | "fontChat") => (id: string) => void save(() => look.store.set(k, id === "theme" ? null : id));
  return (
    <Sec title="Reading">
      <SpecRow r={rowOf("size")} look={look} />
      {level >= 1 ? (
        <>
          <Ctl title="Interface font" keep="everywhere"><Pick value={font("fontUi")} options={FONTS} label="Interface font" onChange={set("fontUi")} /></Ctl>
          <Ctl title="Conversation font" sub="The theme’s own is what the theme was drawn with." keep="everywhere"><Pick value={font("fontChat")} options={FONTS} label="Conversation font" onChange={set("fontChat")} /></Ctl>
          <div className="fontprev-pe18" aria-label="Fonts in use"><span style={{ fontFamily: "var(--sans)" }}>The interface reads like this.</span><span style={{ fontFamily: "var(--chat-font, var(--sans))" }}>A conversation reads like this.</span></div>
        </>
      ) : null}
    </Sec>
  );
}

export function ShownSec({ look }: { look: Look }) {
  return <Sec title="What’s shown">{rowsOf("What’s shown").map((r) => <SpecRow key={r.key} r={r} look={look} />)}</Sec>;
}

const LANGS: Opt[] = [{ id: "en", label: "English" }, ...["Français", "Español", "Deutsch", "Yorùbá"].map((l) => ({ id: l, label: l, off: "Other languages come with the Branch app." }))];
export function LanguageSec() {
  return (
    <Sec title="Language">
      <Ctl title="Language" sub="Dates and numbers follow it too."><Pick value="en" options={LANGS} label="Language" onChange={() => undefined} /></Ctl>
    </Sec>
  );
}

export function TraySec() {
  return (
    <Sec title="Tray">
      <Ctl title="Tray menu" sub="What Branch puts in the tray: its icon and menu." off={DESKTOP}><Btn sm>Open</Btn></Ctl>
    </Sec>
  );
}

/** The sample colours for each code-colour choice: keyword, string, comment (the preview's CODECOL_R618). */
const CODE_SAMPLE: Record<string, [string, string, string]> = {
  theme: ["var(--accent)", "var(--ok)", "var(--ink-3)"], github: ["#cf222e", "#0a3069", "#6e7781"], monokai: ["#f92672", "#e6db74", "#75715e"],
  solarized: ["#859900", "#2aa198", "#93a1a1"], tm: ["#b5651d", "#3a7d44", "#888"],
};

export function ReadingMoreSec({ look }: { look: Look }) {
  const math = look.val("math", true) !== false;
  const cc = CODE_SAMPLE[String(look.val("codeCol", "theme"))] ?? CODE_SAMPLE.theme;
  return (
    <Sec title="Reading">
      {rowsOf(READING_MORE).map((r) => (
        <Fragment key={r.key}>
          <SpecRow r={r} look={look} />
          {r.key === "math" ? (
            <div className="ap-sample" aria-label="Sample">
              {math ? <span className="ap-math"><i>E</i> = <i>m</i><i>c</i><sup>2</sup>{" · "}<span className="ap-frac"><span>a + b</span><span>2</span></span></span> : <code>{String.raw`$E = mc^2$ · $\frac{a+b}{2}$`}</code>}
            </div>
          ) : null}
          {r.key === "codeCol" ? (
            <pre className="ap-code" aria-label="Sample"><span style={{ color: cc[0] }}>const</span> total = sum(receipts) <span style={{ color: cc[2] }}>{"// September"}</span>{"\n"}<span style={{ color: cc[0] }}>return</span> <span style={{ color: cc[1] }}>{'"$1,286.40"'}</span></pre>
          ) : null}
        </Fragment>
      ))}
    </Sec>
  );
}

export function WindowSec({ look }: { look: Look }) {
  return (
    <Sec title="Window">
      <SpecRow r={rowOf("tabs")} look={look} />
      <Ctl title="Customize layout" sub="Drag the list and the side panel to the widths you like." off="Drag the edge of the list or the side panel to change its width."><Btn sm>Customize</Btn></Ctl>
      <SpecRow r={rowOf("kiosk")} look={look} />
    </Sec>
  );
}
