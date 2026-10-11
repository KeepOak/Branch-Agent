import type { AgentState } from "./agentState";
import { Face } from "./Face";

// The classic pebble (DESIGN-SPEC §6.3): shape 0 (Circle), round eyes, coloured with the theme's --ink-2
// (DECISIONS.md item 22; owner, 2026-10-02). At rest it is the still frame; with `state` it plays that state's
// sheet when something happens (§6.2). Face.tsx and player.ts do the drawing.

/** Sapling's face. `size` is the face size in CSS pixels. */
export function Pebble({ size, label, state, priority, where }: { size: number; label?: string; state?: AgentState; priority?: number; where?: string }) {
  return <Face size={size} label={label} state={state} priority={priority} where={where} />;
}
