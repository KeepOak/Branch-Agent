import type { CanopyCard } from "@branch/canopy-contract";
import { jsonResult, readStringParam } from "branch/plugin-sdk/core";
import { safeEqualSecret } from "branch/plugin-sdk/security-runtime";
import { asRecord, readStringValue } from "branch/plugin-sdk/string-coerce-runtime";
import { Type, type TProperties } from "typebox";
import { redactClaimToken } from "./card-redaction.js";
import type { CanopyMutationScope } from "./store-inputs.js";
import type { CanopyStore } from "./store.js";

type CanopyCardMutation = (
  id: string,
  record: Record<string, unknown>,
  scope: CanopyMutationScope,
) => Promise<CanopyCard>;

export function createCanopyCardMutations(store: CanopyStore, ownerId: string) {
  const readParams = async (rawParams: unknown, requireClaim = false) => {
    const record = asRecord(rawParams);
    const id = readStringParam(record, "id", { required: true });
    const token = readStringValue(record.token);
    const card = await store.get(id);
    if (!card) {
      throw new Error(`card not found: ${id}`);
    }
    const claim = card.metadata?.claim;
    if (claim && claim.ownerId !== ownerId && !safeEqualSecret(token, claim.token)) {
      throw new Error(`card is claimed by ${claim.ownerId ?? "another agent"}.`);
    }
    if (requireClaim && !claim) {
      throw new Error("card must be claimed before lifecycle completion.");
    }
    return { record, id, scope: { ownerId, token } };
  };
  const cardMutation =
    (mutate: CanopyCardMutation, requireClaim = false) =>
    async (_toolCallId: string, rawParams: unknown) => {
      const { record, id, scope } = await readParams(rawParams, requireClaim);
      // Nest cards so their status cannot be mistaken for the tool result's status.
      return jsonResult({ card: redactClaimToken(await mutate(id, record, scope)) });
    };
  return {
    readScopedCardToolParams: (rawParams: unknown) => readParams(rawParams),
    scopedCardMutation: cardMutation,
    claimedCardMutation: (mutate: CanopyCardMutation) => cardMutation(mutate, true),
  };
}

export function cardIdField() {
  return Type.String({ description: "Canopy card id." });
}

export function claimTokenField(description = "Claim token returned by canopy_claim.") {
  return Type.Optional(Type.String({ description }));
}

export function strictObject<const Properties extends TProperties>(properties: Properties) {
  return Type.Object(properties, { additionalProperties: false });
}

export function workspaceField() {
  return Type.Optional(
    strictObject({
      kind: Type.String({ description: "scratch, dir, or worktree." }),
      path: Type.Optional(Type.String({ description: "Absolute dir/worktree path." })),
      branch: Type.Optional(Type.String({ description: "Suggested branch." })),
    }),
  );
}
