// A Trunk's face on the Trunk screens: its character, its emoji face, or the classic pebble (preview 15-emoji av()).
import type { CSSProperties, ReactNode } from "react";
import { CharacterFace } from "../../face/CharacterFace";
import { Face } from "../../face/Face";
import { trunkAppearance, type PebbleLook } from "../../face/appearance";
import { lookOf, type TrunkRow } from "./model";

type Props = { name: string; look: string; emoji: string; size: number; draft?: boolean; pebbleLook?: PebbleLook };

/** `draft`: the face being chosen in the editor, so the shell's saved look must not show through. */
export function TrunkFace({ name, look, emoji, size, draft, pebbleLook }: Props) {
  const appearance = look === "classic" ? undefined : trunkAppearance(`branch:${look}`, name, pebbleLook?.colour);
  if (appearance) return <span className="tk-character-fit" style={{ width: size, height: size }}><CharacterFace appearance={appearance} size={size} label={name} /></span>;
  if (emoji) {
    const style = { width: size, height: size, fontSize: Math.round(size * 0.56) } as CSSProperties;
    return <span className="tk-emoji-face" style={style} role="img" aria-label={name}><i>{emoji}</i></span>;
  }
  return draft ? <span role="img" aria-label={name} className="tk-face-wrap"><Face size={size} pebbleLook={pebbleLook} /></span> : <Face size={size} label={name} pebbleLook={pebbleLook} />;
}

export function RowFace({ row, size }: { row: TrunkRow; size: number }) {
  return <TrunkFace name={row.name} look={lookOf(row.avatar, row.name)} emoji={row.emoji} size={size} pebbleLook={row} />;
}

/* Line icons the shell set lacks, drawn on the same 24 px box (DESIGN-SPEC §2.9). */
const PATHS: Record<string, ReactNode> = {
  shield: <path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" />,
  cloud: <path d="M7.5 18.5h9.5a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 9.6a4.5 4.5 0 0 0 .5 8.9z" />,
  spark: <path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z" />,
  plug: <><path d="M9 3.5v4M15 3.5v4" /><path d="M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0z" /><path d="M12 16v4.5" /></>,
  laptop: <><rect x="5" y="5.5" width="14" height="9.5" rx="1.5" /><path d="M3 18.5h18" /></>,
  server: <><rect x="4.5" y="4.5" width="15" height="6" rx="1.5" /><rect x="4.5" y="13.5" width="15" height="6" rx="1.5" /><path d="M8 7.5h.01M8 16.5h.01" /></>,
  bot: <><rect x="5" y="8" width="14" height="10.5" rx="2.5" /><path d="M12 4.5V8M9.5 13h.01M14.5 13h.01" /></>,
};
export function LineIcon({ name, size = 15 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
