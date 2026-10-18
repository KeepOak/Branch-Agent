// New Trunk (preview newTrunkC18, opened as a sheet): a face, a name, shapes and colours, then Create.
// Model, instructions and tools are not here. The new Trunk asks for them in the chat, and they stay in its details and Settings.
import { useState } from "react";
import { Face } from "../../face/Face";
import { Dialog } from "../../shell/Dialog";
import { Layer } from "./layer";
import { canCreateTrunk, startingLook, TRUNK_COLOURS, TRUNK_SHAPES, type NewTrunkDraft, type TrunkColour, type TrunkShape } from "./new-trunk-sheet";
import "./new-trunk-sheet.css";

// Small swatches need clear silhouettes: the face's subtly different pebble radii look alike at this size.
const SHAPE_PATHS: Record<TrunkShape, string> = {
  Circle: "M20 4a16 16 0 1 0 0 32 16 16 0 1 0 0-32Z",
  Stone: "M10 7 27 4Q31 4 33 9L37 23Q38 28 33 31L18 36Q12 38 8 32L3 21Q1 16 5 12Z",
  Leaf: "M5 35Q-1 4 35 5Q36 36 5 35Z",
  Acorn: "M18 2h4v5c8 1 14 6 14 13H4c0-7 6-12 14-13ZM7 23h26c-1 8-7 13-13 15C14 36 8 31 7 23Z",
  Shield: "M4 5h32v13c0 10-8 16-16 20C12 34 4 28 4 18Z",
};

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
              {TRUNK_SHAPES.map((item) => (
                <button key={item} type="button" className="nt-shape" aria-label={item} aria-pressed={shape === item} disabled={busy} onClick={() => setShape(item)}>
                  <svg width="28" height="28" viewBox="0 0 40 40" fill={colour} aria-hidden="true"><path d={SHAPE_PATHS[item]} /></svg>
                  <small>{item}</small>
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
