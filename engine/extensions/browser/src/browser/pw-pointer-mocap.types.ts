/** Structural motion types from elizaOS/eliza@3f38e54495ba5518f84bcf9cc1e84e0dc3d60bbf. */
export type MocapMovement = { dx: number; dy: number; dt: number };
export type MocapSequence = {
  movements: MocapMovement[];
  total_dx: number;
  total_dy: number;
  click_down_dt: number;
  click_up_dt: number;
};
export type MocapLibrary = { meta: Record<string, unknown>; sequences: MocapSequence[] };
export type Rect = { left: number; top: number; right: number; bottom: number };
