import type { Draft } from "./api";
import { COLOURS, EYES, SHAPES } from "./LookTab";
import { EMOJI, LOOKS } from "./model";

/** The face shown in the editor, ignoring fields hidden by a mascot or emoji. */
export function visibleFace(draft: Draft): string {
  if (draft.look !== "classic") return draft.look;
  return draft.emoji || `${draft.colour}|${draft.shape}|${draft.eyes}`;
}

/** Shuffle within the kind of face showing, always excluding the current face. */
export function shuffleLook(draft: Draft, wornLooks: ReadonlySet<string>, random = Math.random): Partial<Draft> {
  if (draft.look !== "classic") {
    const alternatives = LOOKS.filter((l) => l.id !== "classic" && l.id !== "branch" && l.id !== draft.look);
    const free = alternatives.filter((l) => !wornLooks.has(l.id));
    const pool = free.length ? free : alternatives;
    return { look: pool[Math.floor(random() * pool.length)].id, emoji: "" };
  }
  if (draft.emoji) {
    const pool = EMOJI.filter((emoji) => emoji !== draft.emoji);
    return { look: "classic", emoji: pool[Math.floor(random() * pool.length)] };
  }
  const combinations = COLOURS.flatMap((colour) => SHAPES.flatMap((shape) => EYES.map((eyes) => ({ colour, shape, eyes }))));
  const alternatives = combinations.filter((look) => look.colour !== draft.colour || look.shape !== draft.shape || look.eyes !== draft.eyes);
  return alternatives[Math.floor(random() * alternatives.length)];
}
