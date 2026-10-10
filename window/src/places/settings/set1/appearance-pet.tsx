// Settings › Appearance › The pet (§4.7.3): pick one (or none), its name, its sounds and the pets
// you've had. The three pixel pets are drawn from their own pixel maps (the App Preview's PETS).
import { Btn, Ctl, Field, Sec, useSaveRunner, Val } from "../kit";
import { rowOf } from "./appearance-rows";
import { SpecRow, type Look } from "./appearance-sections";

const ART: [string, string][] = [["mossfrog", "Moss frog"], ["leafhog", "Leaf hog"], ["fennec", "Fennec"], ["otter", "Otter"], ["capybara", "Capybara"], ["cloverbun", "Clover bun"], ["owlet", "Owlet"],
  ["shellsnail", "Shell snail"], ["jelly", "Jelly"], ["cloudsheep", "Cloud sheep"], ["pebblecrab", "Pebble beetle"], ["caterpillar", "Caterpillar"], ["sprigdragon", "Sprig dragon"], ["turtle", "Turtle"],
  ["penguin", "Penguin"], ["puppy", "Puppy"], ["kitten", "Kitten"], ["raccoon", "Raccoon"], ["koala", "Koala"], ["sloth", "Sloth"], ["fruitbat", "Fruit Bat"], ["bumblebee", "Bumblebee"],
  ["beetle", "Beetle"], ["duckling", "Duckling"], ["hamster", "Hamster"], ["sealpup", "Seal Pup"], ["octopus", "Octopus"], ["chameleon", "Chameleon"], ["firefly", "Firefly"],
  ["dustbunny", "Dust bunny"], ["mossgolem", "Moss Golem"], ["narwhal", "Narwhal"], ["squirrel", "Squirrel"], ["elephant", "Elephant"]];
const FRESH: [string, string][] = [["redpanda", "Red panda"], ["pangolin", "Pangolin"], ["quokka", "Quokka"], ["goatkid", "Goat kid"], ["piglet", "Teacup piglet"]];

export type Px = { name: string; px: string[]; col: Record<string, string> };
export const PIXEL: Record<string, Px> = {
  "px-squirrel": { name: "Pixel squirrel", px: ["............", ".......oo...", "......oooo..", "..o..ooeooo.", ".ooo.ooooob.", ".oooooooooo.", "..oooobbooo.", "...oooobbo..", "...oo..oo...", "............"], col: { o: "#B8652B", b: "#F2D0AE", e: "#1B1A18" } },
  "px-owl": { name: "Pixel owl", px: ["............", "...o....o...", "...oooooo...", "..owwowwoo..", "..oweoweoo..", "..oooyyooo..", "..obbbbbbo..", "..obbbbbbo..", "...oo..oo...", "............"], col: { o: "#6E5A45", w: "#F4EDE0", e: "#1B1A18", y: "#E0A33B", b: "#A38B6C" } },
  "px-hedgehog": { name: "Pixel hedgehog", px: ["............", "...s.s.s....", "..sssssss...", ".sssssssss..", ".ssssssssfe.", ".sssssssffff", "..ffffffff..", "...f.ff.f...", "............", "............"], col: { s: "#5B4A3B", f: "#D9B48F", e: "#1B1A18" } },
};

export type Pet = { id: string; name: string; still?: string; fresh?: boolean };
export const PETS: Pet[] = [
  { id: "none", name: "None" },
  ...ART.map(([id, name]) => ({ id, name, still: `/assets/pets/${id}.webp` })),
  ...FRESH.map(([id, name]) => ({ id, name, still: `/assets/art17/pets/${id}.webp`, fresh: true })),
  ...Object.entries(PIXEL).map(([id, p]) => ({ id, name: p.name })),
];
export const DEFAULT_PET = "px-squirrel";

/** A pixel pet as a small drawing (brand-free art colours from its pixel map). */
export function PixelPet({ p }: { p: Px }) {
  return (
    <svg className="px-k" viewBox="0 0 24 20" width="56" height="47" aria-hidden="true" shapeRendering="crispEdges">
      {p.px.flatMap((row, y) => [...row].map((ch, x) => (p.col[ch] ? <rect key={`${x}-${y}`} x={x * 2} y={y * 2} width="2" height="2" fill={p.col[ch]} /> : null)))}
    </svg>
  );
}

/** The pets you've had: every pet picked, the one you have now included. */
export function petsHad(look: Look): string[] {
  const had = Array.isArray(look.val("petsHad", [])) ? (look.val("petsHad", []) as string[]) : [];
  const now = String(look.val("pet", DEFAULT_PET));
  return now === "none" || had.includes(now) ? had : [...had, now];
}

export function PetSec({ look, openSettings }: { look: Look; openSettings?: (page: string) => void }) {
  const save = useSaveRunner();
  const cur = String(look.val("pet", DEFAULT_PET));
  const had = petsHad(look), first = look.val("petFirst", "");
  const pick = (id: string) => void save(async () => {
    await look.store.set("pet", id === DEFAULT_PET ? null : id);
    if (id !== "none" && !had.includes(id)) await look.store.set("petsHad", [...had, id]);
    if (!first) await look.store.set("petFirst", new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  });
  return (
    <Sec title="The pet">
      <div className="pets12 ap-k" data-row="Pet">
        {PETS.map((p) => (
          <button key={p.id} type="button" className={`pet-c12${p.fresh ? " new17e" : ""}`} aria-pressed={cur === p.id} onClick={() => pick(p.id)}>
            {p.still ? <img src={p.still} alt="" draggable={false} /> : PIXEL[p.id] ? <PixelPet p={PIXEL[p.id]} /> : <span className="pet-px12">—</span>}
            <b>{p.name}</b>
          </button>
        ))}
      </div>
      <Ctl title="Name" sub="Shown on the pet’s tips and menu.">
        <Field value={String(look.val("petName", "Hazel"))} label="Pet name" onCommit={(v) => void save(() => look.store.set("petName", v.trim() && v.trim() !== "Hazel" ? v.trim().slice(0, 40) : null))} />
      </Ctl>
      <SpecRow r={rowOf("roam")} look={look} />
      <SpecRow r={rowOf("petSounds")} look={look} />
      <Ctl title="Pets you’ve had">
        <Val>{`${had.length} of ${PETS.length - 1}${first ? ` · first ${String(first)}` : ""}`}</Val>
        <Btn sm disabled={!openSettings} onClick={() => openSettings?.("achievements")}>Open</Btn>
      </Ctl>
    </Sec>
  );
}
