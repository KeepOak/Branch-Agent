// Trunk editor › Look (preview 12-look picker, 15 emoji face, 30-trunks §4.4.3): the looks with real art, an emoji face,
// Name, What it's for, and the pebble's Colour, Shape and Eyes.
import { useState } from "react";
import { Face } from "../../face/Face";
import { EMOJI, LOOKS } from "./model";
import type { Draft } from "./api";

export const COLOURS = ["#2F8C86", "#1785AF", "#8A5AA8", "#5E8C4A", "#4F6FA8", "#C9982E", "#B84A6B", "#56616B"];
export const SHAPES = ["Circle", "Stone", "Leaf", "Acorn", "Shield"];
export const EYES = ["Round", "Wide", "Sleepy"];
const RADII = ["50%", "58% 42% 54% 46% / 52% 56% 44% 48%", "46% 54% 42% 58% / 60% 44% 56% 40%", "62% 38% 50% 50% / 45% 55% 45% 55%", "42% 58% 58% 42% / 50% 42% 58% 50%"];
const SEEN_KEY = "branch.looks-seen";

/** Looks that arrived in a later update stay marked "New" until the editor has shown them once. */
export function useNewLooks(): Set<string> {
  const [fresh] = useState(() => {
    let seen: string[] = [];
    try { seen = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]") as string[]; }
    catch (error) { console.warn("looks seen list unreadable", error); }
    const next = new Set(LOOKS.filter((l) => l.later && !seen.includes(l.id)).map((l) => l.id));
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(LOOKS.map((l) => l.id))); }
    catch (error) { console.warn("looks seen list not saved", error); }
    return next;
  });
  return fresh;
}

function Gallery({ draft, set, fresh }: { draft: Draft; set: (d: Partial<Draft>) => void; fresh: Set<string> }) {
  return (
    <div className="tk-looks">
      {LOOKS.map((l) => (
        <button key={l.id} type="button" className={fresh.has(l.id) ? "tk-look new" : "tk-look"} aria-pressed={draft.look === l.id} aria-label={fresh.has(l.id) ? `${l.name}, new` : l.name} onClick={() => set({ look: l.id, ...(l.id === "classic" ? {} : { emoji: "" }) })}>
          {l.still ? <img src={l.still} alt="" draggable={false} /> : <span className="tk-peb-demo"><Face size={56} pebbleLook={draft} /></span>}
          <b>{l.name}</b>
        </button>
      ))}
    </div>
  );
}

function Emojis({ draft, set }: { draft: Draft; set: (d: Partial<Draft>) => void }) {
  const pick = (emoji: string) => set(emoji ? { emoji, look: "classic" } : { emoji: "" });
  return (
    <div className="tk-emo">
      <b>Or an emoji face</b>
      <div className="tk-emo-row" role="radiogroup" aria-label="Emoji face"
        onKeyDown={(e) => { const i = EMOJI.indexOf(draft.emoji); const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0; if (step) { e.preventDefault(); pick(EMOJI[(i + step + EMOJI.length) % EMOJI.length]); } }}>
        {EMOJI.map((e, i) => <button key={e} type="button" role="radio" aria-checked={draft.emoji === e} tabIndex={draft.emoji === e || (!draft.emoji && i === 0) ? 0 : -1} onClick={() => pick(e)}>{e}</button>)}
        {draft.emoji && <button type="button" className="tk-emo-none" onClick={() => pick("")}>None</button>}
      </div>
    </div>
  );
}

function PebbleFields({ draft, set }: { draft: Draft; set: (d: Partial<Draft>) => void }) {
  const classic = draft.look === "classic";
  return (
    <>
      <div className="tk-field">
        <span className="tk-label">Colour</span>
        <div className="tk-swatches">{COLOURS.map((c) => <button key={c} type="button" className="tk-swatch" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={draft.colour === c} onClick={() => set({ colour: c })} />)}</div>
      </div>
      {classic && <div className="tk-field">
        <span className="tk-label">Shape</span>
        <div className="tk-shapes">{SHAPES.map((s, i) => <button key={s} type="button" className="tk-shape" aria-label={s} title={s} aria-pressed={draft.shape === s} onClick={() => set({ shape: s })}><span style={{ borderRadius: RADII[i], background: draft.colour }} /></button>)}</div>
      </div>}
      {classic && <div className="tk-field">
        <span className="tk-label">Eyes</span>
        <span className="tk-seg">{EYES.map((e) => <button key={e} type="button" aria-pressed={draft.eyes === e} onClick={() => set({ eyes: e })}>{e}</button>)}</span>
      </div>}
    </>
  );
}

export function LookTab({ draft, set }: { draft: Draft; set: (d: Partial<Draft>) => void }) {
  const fresh = useNewLooks();
  return (
    <div className="tk-look-tab">
      <section>
        <h3 className="tk-h">How it looks</h3>
        <p className="tk-hint">It moves by itself: thinking, searching, reading, working, waiting for you, celebrating, resting. You never pick an animation; it follows what the Trunk is doing.</p>
        <Gallery draft={draft} set={set} fresh={fresh} />
      </section>
      <Emojis draft={draft} set={set} />
      <div className="tk-split">
        <label className="tk-field"><span className="tk-label">Name</span><input className="inp" value={draft.name} onChange={(e) => set({ name: e.target.value })} /></label>
        <label className="tk-field"><span className="tk-label">What it’s for</span><input className="inp" value={draft.theme} onChange={(e) => set({ theme: e.target.value })} /></label>
      </div>
      <PebbleFields draft={draft} set={set} />
    </div>
  );
}
