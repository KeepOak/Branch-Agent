import { useState } from "react";
import { Dialog } from "../../shell/Dialog";
import { trunkAppearance } from "../../face/appearance";
import { CharacterFace } from "../../face/CharacterFace";
import { LOOKS, lookOf, type Roster } from "./model";
import { Layer } from "./layer";
import { Icon } from "../../shell/icons";

const NAMES = ["Ash", "Elm", "Hazel", "Rowan", "Alder", "Willow", "Linden", "Birch", "Juniper", "Cedar"];
export type TrunkChoice = { name: string; avatar: string };

export function nextTrunkChoice(roster: Roster, previous?: TrunkChoice, fixedName?: string): TrunkChoice {
  const used = new Set(roster.agents.map((row) => row.name.toLowerCase()));
  const names = NAMES.filter((name) => !used.has(name.toLowerCase()) && name !== previous?.name);
  let fallback = roster.agents.length + 1;
  while (used.has(`cedar ${fallback}`) || previous?.name === `Cedar ${fallback}`) fallback++;
  const name = fixedName ?? (names.length ? names[Math.floor(Math.random() * names.length)] : `Cedar ${fallback}`);
  const worn = new Set(roster.agents.map((row) => lookOf(row.avatar, row.name)));
  const looks = LOOKS.filter((look) => look.id !== "classic" && look.id !== "branch" && look.id !== previous?.avatar.replace("branch:", "") && !worn.has(look.id));
  const pool = looks.length ? looks : LOOKS.filter((look) => look.id !== "classic" && look.id !== "branch" && look.id !== previous?.avatar.replace("branch:", ""));
  return { name, avatar: `branch:${pool[Math.floor(Math.random() * pool.length)].id}` };
}

export function NewTrunkPreview({ roster, fixedName, busy, onConfirm, onClose }: { roster: Roster; fixedName?: string; busy?: boolean; onConfirm: (choice: TrunkChoice) => void; onClose: () => void }) {
  const [choice, setChoice] = useState(() => nextTrunkChoice(roster, undefined, fixedName));
  const appearance = trunkAppearance(choice.avatar, choice.name);
  return <Layer><Dialog title="Add a Trunk" onClose={onClose} testid="new-trunk-preview" footer={<>
    <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
    <button type="button" className="btn pri" disabled={busy} onClick={() => onConfirm(choice)}>{busy ? "Creating…" : "Create Trunk"}</button>
  </>}><div className="tk-big">
    {appearance && <CharacterFace appearance={appearance} size={84} label={choice.name} />}
    <button type="button" className="btn sm" disabled={busy} title={fixedName ? "Pick a different look" : "Pick a different name and look"} onClick={() => setChoice(nextTrunkChoice(roster, choice, fixedName))}><Icon name="dice" small />{fixedName ? "Random look" : "Random name"}</button>
    <label className="tk-field"><span className="tk-label">Name</span><input className="inp" value={choice.name} disabled={Boolean(fixedName) || busy} onChange={(event) => setChoice({ ...choice, name: event.target.value })} /></label>
  </div></Dialog></Layer>;
}
