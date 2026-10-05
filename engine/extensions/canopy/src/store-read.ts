import type { CanopyCard } from "@branch/canopy-contract";
import type { CanopyCardReadScope, CanopyCardStore } from "./persistence-types.js";
import { compareCards } from "./store-card-helpers.js";

export function freezeCardList(value: unknown): void {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) {
      freezeCardList(child);
    }
    Object.freeze(value);
  }
}

export async function readCards(
  store: CanopyCardStore,
  scope?: CanopyCardReadScope,
): Promise<CanopyCard[]> {
  const entries = await store.entries(scope);
  return entries
    .flatMap(({ value }) => (value?.version === 1 && value.card?.id ? [value.card] : []))
    .toSorted(compareCards);
}
