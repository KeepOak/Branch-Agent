// Let it roam (Appearance › Pet): while the pet roams, the Trunk card is hidden, so the card comes back through these two.
import { notify } from "./notify";

export type RoamSetting = { set(key: string, value: unknown): Promise<unknown> };

/** Stops the roam and shows the card again, with an Undo that starts the roam back up. */
export function stopRoaming(setting: RoamSetting, showCard: () => void): void {
  void setting.set("roam", false);
  showCard();
  notify("Back on the card.", { action: { label: "Undo", run: () => void setting.set("roam", true) } });
}

/** The header face: while the pet roams it gives the card back; otherwise it shows or hides the card as before. */
export function headerFace(roaming: boolean, setting: RoamSetting, showCard: () => void, toggleCard: () => void): void {
  if (roaming) stopRoaming(setting, showCard);
  else toggleCard();
}
