// The New Trunk sheet (preview editTrunk look controls, then newTrunkC18's chat questions).
// Colour and shape are the preview's pebble sets. Create sends them with the name; the chat asks the rest.
import type { WindowEngine } from "../../connect/engine";
import { existingTrunkId } from "./api";
import { COLOURS } from "./LookTab";

/** Find anything and Settings search open the same sheet the + menu opens. */
export const OPEN_NEW_TRUNK_SHEET = "branch:open-new-trunk-sheet";

export function openNewTrunkSheet(): void {
  window.dispatchEvent(new CustomEvent(OPEN_NEW_TRUNK_SHEET));
}

/** Preview COLOURS, the same list the Trunk editor already uses (LookTab). */
export const TRUNK_COLOURS = COLOURS;
/** Preview shape names, in the same order as the radii. */
export const TRUNK_SHAPES = ["Circle", "Stone", "Leaf", "Acorn", "Shield"] as const;
export const SHAPE_RADII = [
  "50%",
  "58% 42% 54% 46% / 52% 56% 44% 48%",
  "46% 54% 42% 58% / 60% 44% 56% 40%",
  "62% 38% 50% 50% / 45% 55% 45% 55%",
  "42% 58% 58% 42% / 50% 42% 58% 50%",
];

export type TrunkColour = (typeof TRUNK_COLOURS)[number];
export type TrunkShape = (typeof TRUNK_SHAPES)[number];
export type NewTrunkDraft = { name: string; colour: TrunkColour; shape: TrunkShape };

/** The preview's first colour for a new Trunk walks the palette as Trunks are added. Shape starts as a circle. */
export function startingLook(count: number): { colour: TrunkColour; shape: TrunkShape } {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return { colour: TRUNK_COLOURS[n % TRUNK_COLOURS.length], shape: "Circle" };
}

/** Create stays off until the name has a letter or number the person typed. Spaces alone do not count. */
export function canCreateTrunk(name: string): boolean {
  return name.trim().length > 0;
}

/** What the chat says once the questions are answered (preview: All set. I'm Trunk N for now). */
export function newTrunkReadyLine(name: string): string {
  return `All set. I’m “${name}” for now. Change the model, instructions and tools from the Trunk’s details or Settings. What’s the first job?`;
}

const rec = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? value as Record<string, unknown> : {});
const str = (value: unknown) => (typeof value === "string" ? value : "");

function refused(result: unknown): void {
  const r = rec(result);
  if (r.ok === false) {
    const err = r.error;
    throw new Error((typeof err === "string" ? err : str(rec(err).message)) || "The engine did not create the Trunk.");
  }
}

/** agents.create with the pebble the sheet shows. Eyes stay Round; the editor still changes them.
 *  Create again for a name that already exists returns that Trunk so the sheet can open it. */
export async function createShapedTrunk(engine: WindowEngine, draft: NewTrunkDraft): Promise<string> {
  const name = draft.name.trim();
  if (!canCreateTrunk(name)) throw new Error("Give the Trunk a name.");
  if (!TRUNK_COLOURS.includes(draft.colour) || !TRUNK_SHAPES.includes(draft.shape)) throw new Error("Pick a colour and a shape.");
  try {
    const result = await engine.request("agents.create", {
      name,
      avatar: "classic",
      colour: draft.colour,
      shape: draft.shape,
      eyes: "Round",
    });
    refused(result);
    const id = str(rec(result).agentId);
    if (!id) throw new Error("The engine did not confirm that the Trunk was created.");
    return id;
  } catch (error) {
    const existing = await existingTrunkId(engine, name, error);
    if (existing) return existing;
    throw error;
  }
}
