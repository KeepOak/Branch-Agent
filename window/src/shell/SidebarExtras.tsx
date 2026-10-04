// Two small parts of the list (DESIGN-SPEC §4.1.1): the "New:" tip under the Places, from this version's What's new,
// and the pet strip above the person's row when Appearance has the pet walk in the list (the default).
import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { PETS } from "../places/settings/set1/appearance-pet";
import { PetStill } from "./StatusExtras";
import type { NewRow } from "./WhatsNew";

const TIP_KEY = "branch.newsTip";
const readTip = (): string | null => {
  try {
    return localStorage.getItem(TIP_KEY);
  } catch {
    return null; // storage blocked: the tip shows until dismissed in this window
  }
};

/** "New: <first new thing in this version>", with See (opens it) and Dismiss; dismissed per version. */
export function NewsTip({ version, row }: { version: string; row: NewRow | undefined }) {
  const [gone, setGone] = useState(() => readTip() === version);
  if (!row || !version || gone) return null;
  const dismiss = () => {
    setGone(true);
    try {
      localStorage.setItem(TIP_KEY, version);
    } catch {
      // storage blocked: dismissed for this window only
    }
  };
  return (
    <div className="news-tip" role="note" data-testid="news-tip">
      <span className="grow">
        <b>New: {row.title}</b>
        <small>{row.line}</small>
      </span>
      <button type="button" className="link" onClick={() => { dismiss(); row.run(); }}>See</button>
      <button type="button" className="ib" aria-label="Dismiss" title="Dismiss" onClick={dismiss}>
        <Icon name="x" small />
      </button>
    </div>
  );
}

const TIPS = ["Type @ to call a Trunk into any conversation.", "Ctrl K finds anything, even settings.", "Hover anything to see what it does.", "The ring bottom right shows what each account has left."];
const SAY_MS = 6500;
const NUDGE_EVERY_MS = 5 * 60_000;

/** What the pet says when patted: who needs a yes, who is working, else a rotating tip (the preview's petWords). */
export function petWords(waiting: string | null, working: string | null, now = Date.now()): string {
  if (waiting) return `${waiting} needs a yes. It’s in your Inbox.`;
  if (working) return `${working} is working. I’ll shout when it’s done.`;
  return TIPS[Math.floor(now / 60_000) % TIPS.length]!;
}

type PetProps = { pet: { id: string; where: string; name: string }; waiting: string | null; working: string | null };

/** The pet strip (§4.1.1 Pet strip, §6.5): the pet's still; a click shows one tip; it speaks up once when a Trunk waits. */
export function SidePet({ pet, waiting, working }: PetProps) {
  const [say, setSay] = useState("");
  const timer = useRef(0);
  const nudged = useRef(0);
  const speak = (text: string) => {
    setSay(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSay(""), SAY_MS);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!waiting || Date.now() - nudged.current < NUDGE_EVERY_MS) return;
    nudged.current = Date.now();
    speak(petWords(waiting, null));
  }, [waiting]);
  if (pet.where !== "side" || pet.id === "none") return null;
  const kind = (PETS.find((x) => x.id === pet.id)?.name ?? "pet").replace(/^Pixel /, "").toLowerCase();
  return (
    <div className="pet-strip" data-testid="pet-strip">
      <div className="pet-box">
        {say ? <span className="pet-say" role="status">{say}</span> : null}
        <button type="button" className="pet-btn" aria-label={`${pet.name} the ${kind}. Click for a tip.`} title={pet.name} onClick={() => speak(petWords(waiting, working))}>
          <PetStill id={pet.id} size={40} />
        </button>
      </div>
    </div>
  );
}
