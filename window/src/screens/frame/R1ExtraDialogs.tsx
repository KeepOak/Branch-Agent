// Dialogs the Classic shell mounts for the whole window, re-hosted for R1: "Add a computer" from any Settings control
// (branch:add-computer) and the save-progress offer that Settings' "Show me" opens (branch:ckpt-show).
import { useEffect, useState } from "react";
import type { WindowEngine } from "../../connect/engine";
import type { Limits } from "../../shell/status-data";
import { AddComputer } from "../../stage/AddComputer";
import { computersChanged } from "../../stage/computers";
import { SaveProgressOffer, CKPT_PREF } from "../../shell/SaveProgress";
import { lookStore } from "../../places/settings/set1/appearance-store";

/** Whether the save-progress offer is on (Settings › Appearance keeps the switch in the look). Read when this renders:
 *  the offer only needs the value now and then, so it does not subscribe to every look change. */
function saveProgressOn(engine: WindowEngine): boolean {
  try {
    const look = lookStore(engine).snap?.look as Record<string, unknown> | undefined;
    return look?.[CKPT_PREF] !== false;
  } catch {
    return true;
  }
}

export function R1ExtraDialogs({ engine, ready, limits, working }: { engine: WindowEngine; ready: boolean; limits: Limits | null; working: string[] }) {
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const open = () => setAdding(true);
    window.addEventListener("branch:add-computer", open);
    return () => window.removeEventListener("branch:add-computer", open);
  }, []);
  const ckptOn = saveProgressOn(engine);
  return <>
    {adding && ready ? <AddComputer engine={engine} onClose={() => setAdding(false)} onAdded={computersChanged} /> : null}
    {ready ? <SaveProgressOffer engine={engine} limits={limits} on={ckptOn} runningKeys={working} /> : null}
  </>;
}
