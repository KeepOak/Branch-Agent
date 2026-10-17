// New Trunk (preview newTrunkC18, opened as a sheet): a face, a name, shapes and colours, then Create.
// Model, instructions and tools are not here. The new Trunk asks for them in the chat, and they stay in its details and Settings.
import { useState } from "react";
import { Face } from "../../face/Face";
import { Dialog } from "../../shell/Dialog";
import { Layer } from "./layer";
import { canCreateTrunk, SHAPE_RADII, startingLook, TRUNK_COLOURS, TRUNK_SHAPES, type NewTrunkDraft, type TrunkColour, type TrunkShape } from "./new-trunk-sheet";
import "./new-trunk-sheet.css";

export function NewTrunkSheet({ count, busy, error, onClose, onCreate }: {
  count: number;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onCreate: (draft: NewTrunkDraft) => void;
}) {
  const first = startingLook(count);
  const [name, setName] = useState("");
  const [colour, setColour] = useState<TrunkColour>(first.colour);
  const [shape, setShape] = useState<TrunkShape>(first.shape);
  const ready = canCreateTrunk(name) && !busy;
  const submit = () => { if (ready) onCreate({ name: name.trim(), colour, shape }); };
  return (
    <Layer>
      <Dialog title="New Trunk" clear onClose={onClose} testid="new-trunk-sheet" footer={<>
        <button type="button" className="btn ghost" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" form="new-trunk-sheet" className="btn pri" data-solid="" disabled={!ready}>{busy ? "Creating…" : "Create"}</button>
      </>}>
        <form id="new-trunk-sheet" className="nt-sheet" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <div className="nt-face">
            <Face size={84} label={name.trim() || "New Trunk"} pebbleLook={{ colour, shape, eyes: "Round" }} />
          </div>
          <label className="nt-field">
            <span>Name</span>
            <input className="inp" autoFocus autoComplete="off" aria-label="Name" value={name} disabled={busy} onChange={(event) => setName(event.target.value)} />
          </label>
          <div className="nt-field">
            <span>Shape</span>
            <div className="nt-shapes" role="group" aria-label="Shape">
              {TRUNK_SHAPES.map((item, index) => (
                <button key={item} type="button" className="nt-shape" aria-label={item} aria-pressed={shape === item} disabled={busy} onClick={() => setShape(item)}>
                  <span style={{ borderRadius: SHAPE_RADII[index], background: colour }} />
                </button>
              ))}
            </div>
          </div>
          <div className="nt-field">
            <span>Colour</span>
            <div className="nt-colours" role="group" aria-label="Colour">
              {TRUNK_COLOURS.map((item) => (
                <button key={item} type="button" className="nt-colour" style={{ background: item }} aria-label={`Colour ${item}`} aria-pressed={colour === item} disabled={busy} onClick={() => setColour(item)} />
              ))}
            </div>
          </div>
          <span className="nt-vh" role="status">{shape}, colour {colour}.</span>
          {error ? <p className="nt-error" role="alert">{error}</p> : null}
        </form>
      </Dialog>
    </Layer>
  );
}
