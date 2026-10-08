// A conversation's icon and colour (§4.1.6 "Icon and colour", the preview's SUBS_PA18.iconm): the engine keeps them on
// the session (sessions.patch icon / color). Colours are the engine's eight names (SESSION_COLOR_IDS), drawn with
// theme hues; icons are its six glyph ids, one emoji, or a self-contained SVG the gateway checks.
import { useState } from "react";
import type { Conversation } from "../connect/conversations";
import { Icon, type IconName } from "./icons";
import type { MenuItem } from "./Menu";

/** The engine's colour names, the hue each is drawn with, and the name the picker shows (the preview's where it has one). */
export const ROW_COLOURS: { id: string; hue: string; name: string }[] = [
  { id: "cyan", hue: "#2F8C86", name: "Teal" },
  { id: "blue", hue: "#1785AF", name: "Sky" },
  { id: "purple", hue: "#8A5AA8", name: "Plum" },
  { id: "green", hue: "#5E8C4A", name: "Moss" },
  { id: "yellow", hue: "#C9982E", name: "Ochre" },
  { id: "pink", hue: "#B84A6B", name: "Rose" },
  { id: "red", hue: "#B8483A", name: "Red" },
  { id: "orange", hue: "#C8742E", name: "Orange" },
];

export const colourHue = (id: string | undefined): string | null => ROW_COLOURS.find((c) => c.id === id)?.hue ?? null;

/** The engine's glyph ids (SESSION_ICON_GLYPH_IDS) in the preview's order, with the line icon and the name each shows. */
export const ROW_GLYPHS: { id: string; icon: IconName; name: string }[] = [
  { id: "braces", icon: "code", name: "Code" },
  { id: "book", icon: "bookOpen", name: "Book" },
  { id: "monitor", icon: "monitor", name: "Screen" },
  { id: "bot", icon: "spark", name: "Assistant" },
  { id: "kanban", icon: "board", name: "Board" },
  { id: "coins", icon: "coins", name: "Coins" },
];
const EMOJI = ["📌", "⭐", "🔥", "💡", "📚", "🧾", "✈️", "🏠", "🧪", "🛠️", "💬", "🎯"];

/** A known glyph, one emoji, or an SVG. Anything else (a broken mark, a raw id) is not drawn. */
export function visibleRowIcon(value: string | undefined): "glyph" | "svg" | "emoji" | null {
  if (!value) return null;
  if (ROW_GLYPHS.some((glyph) => glyph.id === value)) return "glyph";
  if (value.startsWith("data:image/svg+xml")) return "svg";
  const parts = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)];
  if (parts.length === 1 && /\p{Extended_Pictographic}/u.test(value)) return "emoji";
  return null;
}

/** The icon before a row's name: a glyph, an emoji or the SVG. */
export function RowIcon({ value }: { value: string | undefined }) {
  const kind = visibleRowIcon(value);
  if (kind === "glyph") {
    const glyph = ROW_GLYPHS.find((item) => item.id === value);
    return glyph ? <span className="cico" aria-hidden="true"><Icon name={glyph.icon} size={14} /></span> : null;
  }
  if (kind === "svg" && value) {
    return <span className="cico" aria-hidden="true"><img src={value} alt="" width={14} height={14} /></span>;
  }
  if (kind === "emoji") return <span className="cico emo" aria-hidden="true">{value}</span>;
  return null;
}

/** What "Use" sends for a custom icon: an SVG as a data URL, or one emoji; null with the reason when it can't be used. */
export function customIcon(text: string): { value: string } | { error: string } {
  const v = text.trim();
  if (!v) return { error: "Type one emoji, or paste an SVG." };
  if (v.startsWith("<")) {
    if (new Blob([v]).size > 16384 || !/^<svg[\s>][\s\S]*<\/svg>$/i.test(v)) return { error: "That SVG can’t be used." };
    return { value: `data:image/svg+xml,${encodeURIComponent(v)}` };
  }
  const parts = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(v)];
  if (parts.length !== 1 || !/\p{Extended_Pictographic}/u.test(v)) return { error: "Use one emoji." };
  return { value: v };
}

type PickerProps = { row: Conversation; onSet: (patch: { icon?: string | null; color?: string | null }) => Promise<string | null> };

/** The Icon and colour grids, drawn inside a menu: Colour, Icon, a custom icon field, Reset to default. */
export function IconColourPicker({ row, onSet }: PickerProps) {
  const [colour, setColour] = useState(row.color ?? null);
  const [icon, setIcon] = useState(row.icon ?? null);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState("");
  const send = async (patch: { icon?: string | null; color?: string | null }) => {
    const failed = await onSet(patch);
    setError(failed ?? "");
    if (failed) return;
    if ("color" in patch) setColour(patch.color ?? null);
    if ("icon" in patch) setIcon(patch.icon ?? null);
  };
  const use = () => {
    const r = customIcon(custom);
    if ("error" in r) setError(r.error);
    else void send({ icon: r.value });
  };
  return (
    <div className="icm" data-testid="icon-colour">
      <div className="ph">Colour</div>
      <div className="swr">
        {ROW_COLOURS.map((c) => (
          <button key={c.id} type="button" className="swc" aria-pressed={colour === c.id} aria-label={c.name} title={c.name} style={{ ["--sw" as string]: c.hue }} onClick={() => void send({ color: c.id })} />
        ))}
        <button type="button" className="swc none" aria-pressed={!colour} aria-label="None" title="None" onClick={() => void send({ color: null })}>
          <Icon name="x" size={12} />
        </button>
      </div>
      <div className="ph">Icon</div>
      <div className="icg">
        {EMOJI.map((e) => (
          <button key={e} type="button" aria-pressed={icon === e} aria-label={e} onClick={() => void send({ icon: icon === e ? null : e })}>{e}</button>
        ))}
        {ROW_GLYPHS.map((g) => (
          <button key={g.id} type="button" aria-pressed={icon === g.id} aria-label={g.name} title={g.name} onClick={() => void send({ icon: icon === g.id ? null : g.id })}>
            <Icon name={g.icon} small />
          </button>
        ))}
      </div>
      <div className="ci">
        <input className="inp" placeholder="Custom icon…" aria-label="Custom icon: one emoji, or paste an SVG" autoComplete="off" value={custom}
          onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") use(); }} />
        <button type="button" className="btn sm" onClick={use}>Use</button>
      </div>
      <p className="hint ci-err" role="alert">{error}</p>
      <hr />
      <button type="button" className="mi" onClick={() => void send({ icon: null, color: null })}>
        <i className="mi-ico" aria-hidden="true"><Icon name="retry" small /></i>
        <span>Reset to default</span>
      </button>
    </div>
  );
}

/** "Icon and colour ›" (key i), a submenu holding the picker. */
export function iconColourItem(row: Conversation, onSet: PickerProps["onSet"]): MenuItem {
  return { kind: "sub", label: "Icon and colour", letter: "i", icon: <Icon name="spark" small />, testid: "menu-icon-colour", items: [{ kind: "custom", node: <IconColourPicker row={row} onSet={onSet} /> }] };
}
