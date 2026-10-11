// The pet in the chat's lane above the composer; outside a chat it is not mounted.
import { useEffect, useRef, useState } from "react";
import { PETS, PIXEL, PixelPet } from "../places/settings/set1/appearance-pet";
import { Menu, type MenuItem } from "./Menu";

const TIPS = ["Type @ to call a Trunk into any conversation.", "Ctrl K finds anything, even settings.", "Hover anything to see what it does.", "The ring bottom right shows what each account has left."];
const STEP_MS = 360;
const SAY_MS = 6500;

/** What the pet says when patted: the first Trunk waiting on a yes, else the tip for this minute. */
export function petWords(waiting: string | null, now = Date.now()): string {
  return waiting ? `${waiting} needs a yes. It’s in your Inbox.` : TIPS[Math.floor(now / 60000) % TIPS.length];
}

/** The roaming pet (Appearance › Pet › Let it roam): it walks the chat lane and its menu can stop it, which brings the card back. */
export function SidebarPet({ pet, waiting, still, working = false, onStopRoaming }: { pet: { id: string; name: string }; waiting: string | null; still: boolean; working?: boolean; onStopRoaming?: () => void }) {
  const strip = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [dir, setDir] = useState(1);
  const [say, setSay] = useState<string | null>(null);
  const [napping, setNapping] = useState(false);
  const [cheering, setCheering] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [keepStill, setKeepStill] = useState(() => document.documentElement.hasAttribute("data-still"));
  const wasWorking = useRef(false);
  const lastActivity = useRef(Date.now());
  const shown = pet.id !== "none";
  useEffect(() => {
    const observer = new MutationObserver(() => setKeepStill(document.documentElement.hasAttribute("data-still")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-still"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (working) { lastActivity.current = Date.now(); setNapping(false); }
    if (wasWorking.current && !working) {
      setCheering(true);
      const timer = window.setTimeout(() => setCheering(false), 3000);
      wasWorking.current = working;
      return () => window.clearTimeout(timer);
    }
    wasWorking.current = working;
  }, [working]);
  useEffect(() => {
    if (!shown || still || keepStill) return;
    const id = window.setInterval(() => {
      if (Date.now() - lastActivity.current > 120_000) { setNapping(true); return; }
      if (napping || cheering) return;
      const max = Math.max(8, (strip.current?.clientWidth ?? 0) - 56);
      setX((px) => {
        const next = px + dir * (working ? 12 : 6);
        if (next + 8 > max) { setDir(-1); return px; }
        if (next < 0) { setDir(1); return 0; }
        return next;
      });
    }, working ? STEP_MS / 2 : STEP_MS);
    return () => window.clearInterval(id);
  }, [shown, still, keepStill, dir, working, napping, cheering]);
  useEffect(() => {
    if (!say) return;
    const id = window.setTimeout(() => setSay(null), SAY_MS);
    return () => window.clearTimeout(id);
  }, [say]);
  if (!shown) return null;
  const painted = PETS.find((p) => p.id === pet.id)?.still;
  const wake = () => { lastActivity.current = Date.now(); setNapping(false); };
  const tip = () => { wake(); setSay(petWords(waiting)); };
  const items: MenuItem[] = [
    { label: "Show a tip", run: tip, testid: "pet-tip" },
    { kind: "sep" },
    { label: "Stop roaming", run: () => onStopRoaming?.(), testid: "pet-stop-roaming" },
  ];
  return (
    <div className="keeper" ref={strip}>
      <div className={dir < 0 ? "petbox flip" : "petbox"} style={{ transform: `translateX(${8 + x}px)` }} >
        {say ? <span className="pet-say" role="status">{say}</span> : null}
        {napping && !still && !keepStill ? <span className="pet-zz" aria-hidden="true">Zz</span> : null}
        <button type="button" className="pet-btn" aria-label={`${pet.name}. Tips and options.`} aria-haspopup="menu" onClick={(event) => { wake(); const box = event.currentTarget.getBoundingClientRect(); setMenu({ x: box.left, y: box.top }); }}>
          {painted ? still || keepStill || napping ? <img className="still13" src={painted} alt="" width={44} height={44} draggable={false} /> : <video src={`/assets/pets/${pet.id}-${cheering ? "cheer" : "walk"}.webm`} poster={painted} width={44} height={44} muted autoPlay playsInline loop={!cheering} onLoadedMetadata={(event) => { event.currentTarget.playbackRate = working && !cheering ? 1.5 : 1; }} /> : PIXEL[pet.id] ? <PixelPet p={PIXEL[pet.id]} /> : null}
        </button>
      </div>
      {menu ? <Menu at={menu} upward label={pet.name} items={items} onClose={() => setMenu(null)} testid="pet-menu" /> : null}
    </div>
  );
}
