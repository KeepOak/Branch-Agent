// Guide › What Branch can do (the preview's DLG_R618.cando): eight things Branch does, each opening where it
// happens. The conversation ones open the default Trunk's conversation with the ask written in its message box,
// ready to send or change; nothing is sent until the person sends it.
import { Dialog } from "./Dialog";

export type CanDoGo =
  | { kind: "ask"; text: string }
  | { kind: "place"; place: "automations" | "library" }
  | { kind: "settings"; page: "computer" | "voice" }
  | { kind: "pair" };

export const CAN_DO: [string, string, CanDoGo][] = [
  ["Sort a messy folder", "Tidy Downloads without deleting anything", { kind: "ask", text: "Tidy my Downloads folder. Don't delete anything." }],
  ["Read and answer mail", "Drafts in your voice; asks before sending", { kind: "ask", text: "Read my new mail and draft replies in my voice. Ask before sending anything." }],
  ["Research with sources", "A one-page brief with numbered sources", { kind: "ask", text: "Research this and write a one-page brief with numbered sources: " }],
  ["Run on a schedule", "A morning brief at 7:00", { kind: "place", place: "automations" }],
  ["Use its own computer", "A browser and a desktop of its own", { kind: "settings", page: "computer" }],
  ["Talk", "Voice, both ways", { kind: "settings", page: "voice" }],
  ["Work from your phone", "Approve from anywhere", { kind: "pair" }],
  ["Remember", "What you tell it, and where it came from", { kind: "place", place: "library" }],
];

export function CanDoDialog({ onClose, onGo }: { onClose: () => void; onGo: (go: CanDoGo) => void }) {
  return (
    <Dialog title="What Branch can do" wide onClose={onClose} testid="can-do">
      <div className="r618-cando">
        {CAN_DO.map(([title, line, go]) => (
          <button key={title} type="button" className="r618-pick" onClick={() => onGo(go)}>
            <b>{title}</b>
            <small>{line}</small>
          </button>
        ))}
      </div>
      <p className="hint">Each one opens where it happens.</p>
    </Dialog>
  );
}
