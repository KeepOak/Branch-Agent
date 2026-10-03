import type { CanopyCard } from "@branch/canopy-contract";

type CanopyCardLookupResult =
  | { card: CanopyCard; error?: undefined }
  | { card?: undefined; error: string };

export function resolveCanopyCardByIdOrPrefix(
  cards: readonly CanopyCard[],
  id: string,
): CanopyCardLookupResult {
  const exact = cards.find((card) => card.id === id);
  if (exact) {
    return { card: exact };
  }
  const matches = cards.filter((card) => card.id.startsWith(id));
  if (matches.length === 0) {
    return { error: `Card not found: ${id}` };
  }
  if (matches.length > 1) {
    return { error: `Ambiguous card id prefix: ${id} (${matches.length} matches)` };
  }
  const card = matches[0];
  return card ? { card } : { error: `Card not found: ${id}` };
}
