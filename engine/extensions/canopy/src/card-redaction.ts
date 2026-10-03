import type { CanopyCard } from "@branch/canopy-contract";
import type { CanopyDispatchResult } from "./store-inputs.js";

export function redactClaimToken(card: CanopyCard): CanopyCard {
  const claim = card.metadata?.claim;
  if (!claim) {
    return card;
  }
  return {
    ...card,
    metadata: {
      ...card.metadata,
      claim: {
        ...claim,
        token: "[redacted]",
      },
    },
  };
}

export function redactDispatchResult<T extends CanopyDispatchResult>(result: T): T {
  return {
    ...result,
    promoted: result.promoted.map(redactClaimToken),
    reclaimed: result.reclaimed.map(redactClaimToken),
    blocked: result.blocked.map(redactClaimToken),
    orchestrated: result.orchestrated.map(redactClaimToken),
  };
}
