import type { CanopyCard } from "@branch/canopy-contract";
import type {
  PersistedCanopyCard,
  CanopyCardReadScope,
  CanopyCardStore,
} from "./persistence-types.js";
import { compareCards } from "./store-card-helpers.js";

export async function readCards(
  store: CanopyCardStore,
  scope?: CanopyCardReadScope,
): Promise<CanopyCard[]> {
  const entries = await store.entries(scope);
  return entries
    .map((entry) => entry.value)
    .filter(
      (entry): entry is PersistedCanopyCard => entry?.version === 1 && Boolean(entry.card?.id),
    )
    .map((entry) => entry.card)
    .toSorted(compareCards);
}
