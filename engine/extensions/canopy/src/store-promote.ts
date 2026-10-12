import type { CanopyCard } from "@branch/canopy-contract";
import { appendComment, assertCanMutateClaimedCard } from "./store-card-helpers.js";
import { CanopyEnrichmentStore } from "./store-enrichment.js";
import type { CanopyMutationScope, CanopyPromoteInput } from "./store-inputs.js";
import { clearDiagnostics, normalizeBoundedString } from "./store-normalizers.js";

export class CanopyPromoteStore extends CanopyEnrichmentStore {
  async move(
    id: string,
    status: unknown,
    position: unknown,
    scope?: CanopyMutationScope,
    options: { expectedUpdatedAt?: number; assertOwnerCurrent?: () => void } = {},
  ): Promise<CanopyCard> {
    return await this.enqueueMutation(async () => {
      const result = await this.updateLatestCard(
        id,
        (current) => {
          // Recheck after every cross-host CAS conflict so a worker cannot move
          // a card claimed between the read and write.
          assertCanMutateClaimedCard(current, scope);
          return { status, position };
        },
        {
          allowMetadataDependencyLinks: false,
          enforceStatusHolds: true,
          expectedUpdatedAt: options.expectedUpdatedAt,
        },
      );
      return result.card;
    }, options.assertOwnerCurrent);
  }

  async promote(
    id: string,
    input: CanopyPromoteInput = {},
    scope?: CanopyMutationScope | null,
  ): Promise<CanopyCard> {
    return await this.enqueueMutation(async () => {
      const existing = await this.requireCard(id);
      assertCanMutateClaimedCard(existing, scope === null ? undefined : scope);
      const reason = normalizeBoundedString(input.reason, undefined, 1000, "promote reason");
      const comments = appendComment(existing.metadata?.comments, reason);
      return await this.updateCard(
        await this.requireCard(id),
        {
          status: "ready",
          metadata: {
            ...clearDiagnostics(existing.metadata, ["stranded_ready", "blocked_too_long"]),
            comments,
            stale: null,
          },
        },
        { enforceStatusHolds: input.force !== true },
      );
    });
  }
}
