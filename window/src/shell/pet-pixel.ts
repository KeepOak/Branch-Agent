import type { PetReaction } from "./pet-reaction";
export type PixelFrame = { pose: string; ms: number; lift: number; shut?: boolean; step?: boolean };
type PixelDefinition = { col: Record<string, string>; eye: string[]; poses: Record<string, string[]> };
export const PIXEL_POSES: Record<string, PixelDefinition> = {
    squirrel: {col: {o: '#B8652B', b: '#F2D0AE', e: '#1B1A18'}, eye: ['e', 'o'], poses: {
      rest: ['............', '.......oo...', '......oooo..', '..o..ooeooo.', '.ooo.ooooob.', '.oooooooooo.', '..oooobbooo.', '...oooobbo..', '...oo..oo...', '............'],
      squash: ['............', '............', '.......oo...', '......oooo..', '..o..ooeooo.', '.ooo.ooooob.', '..oooobbooo.', '...oooobbo..', '...oo..oo...', '............'],
      stretch: ['.......oo...', '......oooo..', '..o..ooeooo.', '.ooo.ooooob.', '.oooooooooo.', '.oooooooooo.', '..oooobbooo.', '...oooobbo..', '...oo..oo...', '............'],
      perk: ['........o...', '.......oo...', '......oooo..', '..o..ooeooo.', '.ooo.ooooob.', '.oooooooooo.', '..oooobbooo.', '...oooobbo..', '...oo..oo...', '............']}},
    owl: {col: {o: '#6E5A45', w: '#F4EDE0', e: '#1B1A18', y: '#E0A33B', b: '#A38B6C'}, eye: ['e', 'w'], poses: {
      rest: ['............', '...o....o...', '...oooooo...', '..owwowwoo..', '..oweoweoo..', '..oooyyooo..', '..obbbbbbo..', '..obbbbbbo..', '...oo..oo...', '............'],
      squash: ['............', '............', '...o....o...', '...oooooo...', '..owwowwoo..', '..oweoweoo..', '..oooyyooo..', '..obbbbbbo..', '...oo..oo...', '............'],
      stretch: ['...o....o...', '...oooooo...', '..owwowwoo..', '..oweoweoo..', '..oooyyooo..', '..obbbbbbo..', '..obbbbbbo..', '..obbbbbbo..', '...oo..oo...', '............'],
      perk: ['...o....o...', '...o....o...', '...oooooo...', '..owwowwoo..', '..oweoweoo..', '..oooyyooo..', '..obbbbbbo..', '..obbbbbbo..', '...oo..oo...', '............']}},
    hedgehog: {col: {s: '#5B4A3B', f: '#D9B48F', e: '#1B1A18'}, eye: ['e', 'f'], poses: {
      rest: ['............', '...s.s.s....', '..sssssss...', '.sssssssss..', '.ssssssssfe.', '.sssssssffff', '..ffffffff..', '...f.ff.f...', '............', '............'],
      squash: ['............', '............', '...s.s.s....', '..sssssss...', '.ssssssssfe.', '.sssssssffff', '..ffffffff..', '...f.ff.f...', '............', '............'],
      stretch: ['...s.s.s....', '..sssssss...', '.sssssssss..', '.sssssssss..', '.ssssssssfe.', '.sssssssffff', '..ffffffff..', '...f.ff.f...', '............', '............'],
      perk: ['...s.s.s....', '...s.s.s....', '..sssssss...', '.sssssssss..', '.ssssssssfe.', '.sssssssffff', '..ffffffff..', '...f.ff.f...', '............', '............']}}
  };
const hop = (peak: number, shut: boolean): PixelFrame[] => [
  {pose: "stretch", ms:120, lift:Math.round(peak*.6), shut}, {pose:"stretch", ms:195, lift:peak, shut},
  {pose:"rest", ms:105, lift:Math.round(peak*.4), shut}, {pose:"squash", ms:120, lift:0}, {pose:"rest", ms:360, lift:0}
];
export const PIXEL_REACTIONS: Record<PetReaction, PixelFrame[]> = {
  pat: [{pose:"squash", ms:300, lift:0, shut:true}, ...hop(4,false)],
  cheer: [{pose:"squash", ms:120, lift:0}, ...hop(7,true)],
  notice: [{pose:"rest", ms:150, lift:0, shut:true}, {pose:"rest", ms:150, lift:0},
    {pose:"perk", ms:420, lift:0}, {pose:"perk", ms:360, lift:0, step:true},
    {pose:"perk", ms:360, lift:0}, {pose:"perk", ms:360, lift:0, step:true}, {pose:"rest", ms:360, lift:0}]
};
export const PIXEL_REST: PixelFrame = { pose:"rest", ms:0, lift:0 };
export function pixelCells(id: string, frame: PixelFrame): { x:number; y:number; colour:string }[] {
  const pet = PIXEL_POSES[id.replace(/^px-/, "")];
  if (!pet) return [];
  const grid = pet.poses[frame.pose] ?? pet.poses.rest;
  const feet = grid.reduce((low, row, i) => /[^.]/.test(row) ? i : low, grid.length - 1);
  return grid.flatMap((row,y) => [...row].flatMap((char,x) => {
    const key = frame.shut && char === pet.eye[0] ? pet.eye[1] : char;
    return pet.col[key] ? [{ x:x*2, y:y*2-(frame.step && y >= feet ? 1 : 0), colour:pet.col[key] }] : [];
  }));
}
