import type { CanopyCard } from "@branch/canopy-contract";
import { jsonResult, readStringParam } from "branch/plugin-sdk/core";
import { safeEqualSecret } from "branch/plugin-sdk/security-runtime";
import { asRecord, readStringValue } from "branch/plugin-sdk/string-coerce-runtime";
import { Type, type TProperties } from "typebox";
import { redactClaimToken } from "./card-redaction.js";
import type { CanopyMutationScope } from "./store-inputs.js";
import type { CanopyStore } from "./store.js";

function canMutateCard(card: CanopyCard, ownerId: string, token?: string): boolean {
  const claim = card.metadata?.claim;
  return !claim || claim.ownerId === ownerId || safeEqualSecret(token, claim.token);
}

export async function requireScopedCard(
  store: CanopyStore,
  cardId: string,
  ownerId: string,
  token?: string,
): Promise<CanopyCard> {
  const card = await store.get(cardId);
  if (!card) {
    throw new Error(`card not found: ${cardId}`);
  }
  if (!canMutateCard(card, ownerId, token)) {
    throw new Error(`card is claimed by ${card.metadata?.claim?.ownerId ?? "another agent"}.`);
  }
  return card;
}

type CanopyToolCardParams = {
  record: Record<string, unknown>;
  id: string;
  scope: CanopyMutationScope;
};
type CanopyCardMutation = (
  id: string,
  record: Record<string, unknown>,
  scope: CanopyToolCardParams["scope"],
) => Promise<CanopyCard>;

// Card payloads stay nested under `card`: the host grades a tool call from
// reserved keys on `details` (`status`, `ok`, `error`, ...), so a flat card
// would report every mutation of a blocked card as a failed tool call.
function redactedCardResult(card: CanopyCard) {
  return jsonResult({ card: redactClaimToken(card) });
}

export function createCanopyCardMutations(store: CanopyStore, ownerId: string) {
  const readParams = async (
    rawParams: unknown,
    requireClaim = false,
  ): Promise<CanopyToolCardParams> => {
    const record = asRecord(rawParams);
    const id = readStringParam(record, "id", { required: true });
    const token = readStringValue(record.token);
    const card = await requireScopedCard(store, id, ownerId, token);
    if (requireClaim && !card.metadata?.claim) {
      throw new Error("card must be claimed before lifecycle completion.");
    }
    return { record, id, scope: { ownerId, token } };
  };
  const cardMutation =
    (mutate: CanopyCardMutation, requireClaim = false) =>
    async (_toolCallId: string, rawParams: unknown) => {
      const { record, id, scope } = await readParams(rawParams, requireClaim);
      return redactedCardResult(await mutate(id, record, scope));
    };
  return {
    readScopedCardToolParams: (rawParams: unknown) => readParams(rawParams),
    scopedCardMutation: (mutate: CanopyCardMutation) => cardMutation(mutate),
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
