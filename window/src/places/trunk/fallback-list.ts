// The fallback list's plain helpers: the name a model shows as, and the list after one row moves.
import type { ModelChoice } from "../../composer/model";

export const modelName = (models: ModelChoice[], ref: string) => models.find((m) => m.ref === ref)?.name || ref.split("/").pop() || ref;

/** The list with the entry at `from` moved to `to`; the same list when either index is off the ends. */
export function moved(list: string[], from: number, to: number): string[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
