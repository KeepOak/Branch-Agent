// The roaming pet in the R1 window (QUEUE item 18: it walks on the composer's top edge). The Classic pet
// (shell/SidebarPet.tsx) is re-hosted unchanged: it walks left and right, flips to face where it goes, naps, cheers when
// work ends, and its menu has Show a tip and Stop roaming. Appearance › Pet › Let it roam turns it on (look key roam),
// as in Classic. Here its lane has no height and sits on the pill's top rim, so its feet stand on the rim and nothing
// covers the text field. With reduced motion it stands still on the rim.
import { useSyncExternalStore } from "react";
import type { WindowEngine } from "../../connect/engine";
import { lookStore } from "../../places/settings/set1/appearance-store";
import { stopRoaming } from "../../shell/pet-roam";
import { usePetLook } from "../../shell/shown";
import { SidebarPet } from "../../shell/SidebarPet";
import "./pet.css";

const REDUCED = "(prefers-reduced-motion: reduce)";
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    listener => { if (typeof matchMedia !== "function") return () => undefined; const media = matchMedia(REDUCED); media.addEventListener("change", listener); return () => media.removeEventListener("change", listener); },
    () => typeof matchMedia === "function" && matchMedia(REDUCED).matches,
  );
}

type Props = {
  engine: WindowEngine;
  /** Something is working: the pet walks faster, and cheers when it ends. */
  working: boolean;
  /** The first Trunk waiting on a yes, for the pet's tip. */
  waiting: string | null;
};

export function ComposerPet({ engine, working, waiting }: Props) {
  const pet = usePetLook(engine);
  const still = useReducedMotion();
  if (!pet.roam || pet.id === "none") return null;
  // R1 has no character card yet, so stopping the roam only turns the roam off (with Undo).
  return <div className="r1-pet-rim" aria-label="Pet">
    <SidebarPet pet={pet} still={still} working={working} waiting={waiting} onStopRoaming={() => stopRoaming(lookStore(engine), () => undefined)} />
  </div>;
}
