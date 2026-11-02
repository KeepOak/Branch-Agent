// Library › Activity (UI audit DA-45): one tab for what happened, in place of "Made for you" and "Logbook".
// A two-way switch picks "Made by Trunks" (files, dashboards, images and apps) or "Your day" (the screen timeline).
import type { WindowEngine } from "../../connect/engine";
import type { Trunk } from "./data";
import { LogbookTab } from "./logbook";
import { MadeTab } from "./made";

const ACTIVITY_PARTS = [["made", "Made by Trunks"], ["day", "Your day"]] as const;
export type ActivityPart = (typeof ACTIVITY_PARTS)[number][0];

type Props = { engine: WindowEngine; trunks: Trunk[]; part: ActivityPart; onPart: (p: ActivityPart) => void; openConversation: (key: string) => void; openSettings?: (page: string) => void };

export function ActivityTab({ engine, trunks, part, onPart, openConversation, openSettings }: Props) {
  const at = ACTIVITY_PARTS.findIndex(([id]) => id === part);
  return <>
    <span className="seg lib-act-seg" role="radiogroup" aria-label="Activity" style={{ ["--i" as string]: at, ["--n" as string]: ACTIVITY_PARTS.length }}>
      {ACTIVITY_PARTS.map(([id, label]) => <button key={id} type="button" role="radio" aria-checked={id === part} onClick={() => onPart(id)}>{label}</button>)}
    </span>
    {part === "made" ? <MadeTab engine={engine} trunks={trunks} openConversation={openConversation} /> : <LogbookTab engine={engine} openSettings={openSettings} />}
  </>;
}
