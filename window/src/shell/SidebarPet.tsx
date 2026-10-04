// The pet in the list (the preview's .keeper / .petbox): when Appearance › The pet has it walk in "The list", it paces
// the strip above the person's row and, patted, says one useful line: who needs a yes, else a tip.
import { useEffect, useRef, useState } from "react";
import { PETS, PIXEL, PixelPet } from "../places/settings/set1/appearance-pet";

const TIPS = ["Type @ to call a Trunk into any conversation.", "Ctrl K finds anything, even settings.", "Hover anything to see what it does.", "The ring bottom right shows what each account has left."];
const STEP_MS = 360;
const SAY_MS = 6500;

/** What the pet says when patted: the first Trunk waiting on a yes, else the tip for this minute. */
export function petWords(waiting: string | null, now = Date.now()): string {
  return waiting ? `${waiting} needs a yes. It’s in your Inbox.` : TIPS[Math.floor(now / 60000) % TIPS.length];
}

export function SidebarPet({ pet, waiting, still }: { pet: { id: string; where: string; name: string }; waiting: string | null; still: boolean }) {
  const strip = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [dir, setDir] = useState(1);
  const [say, setSay] = useState<string | null>(null);
  const shown = pet.where === "side" && pet.id !== "none";
  useEffect(() => {
    if (!shown || still) return;
    const id = window.setInterval(() => {
      const max = Math.max(8, (strip.current?.clientWidth ?? 0) - 56);
      setX((px) => {
        const next = px + dir * 6;
        if (next + 8 > max) { setDir(-1); return px; }
        if (next < 0) { setDir(1); return 0; }
        return next;
      });
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [shown, still, dir]);
  useEffect(() => {
    if (!say) return;
    const id = window.setTimeout(() => setSay(null), SAY_MS);
    return () => window.clearTimeout(id);
  }, [say]);
  if (!shown) return null;
  const painted = PETS.find((p) => p.id === pet.id)?.still;
  return (
    <div className="keeper" ref={strip}>
      <div className={dir < 0 ? "petbox flip" : "petbox"} style={{ left: 8 + x }} data-hide="pet">
        {say ? <span className="pet-say" role="status">{say}</span> : null}
        <button type="button" className="pet-btn" aria-label={`${pet.name}. Click for a tip.`} onClick={() => setSay(petWords(waiting))}>
          {painted ? <img className="still13" src={painted} alt="" width={44} height={44} draggable={false} /> : PIXEL[pet.id] ? <PixelPet p={PIXEL[pet.id]} /> : null}
        </button>
      </div>
    </div>
  );
}
