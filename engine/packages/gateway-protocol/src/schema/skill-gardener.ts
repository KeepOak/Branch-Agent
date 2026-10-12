import type { Static } from "typebox";
import { Type } from "typebox";
import { closedObject } from "./closed-object.js";
import { NonEmptyString } from "./primitives.js";

const SkillLifecycleStateSchema = Type.Union([
  Type.Literal("active"),
  Type.Literal("stale"),
  Type.Literal("archived"),
]);

const SkillGardenerEntrySchema = closedObject({
  skillFile: NonEmptyString,
  skillKey: NonEmptyString,
  skillName: NonEmptyString,
  state: SkillLifecycleStateSchema,
  pinned: Type.Boolean(),
  createdAtMs: Type.Number(),
  stateChangedAtMs: Type.Number(),
  lastUsedAtMs: Type.Union([Type.Number(), Type.Null()]),
  useCount: Type.Number(),
  archivedReason: Type.Union([Type.String(), Type.Null()]),
});

const SkillOverlapCandidateSchema = closedObject({
  left: NonEmptyString,
  right: NonEmptyString,
  score: Type.Number(),
});

const SkillCollectionReviewStatusSchema = closedObject({
  attemptedAtMs: Type.Number(),
  succeededAtMs: Type.Optional(Type.Number()),
  error: Type.Optional(Type.String()),
});

const SkillExperienceReviewStatusSchema = closedObject({
  attemptedAtMs: Type.Number(),
  outcome: Type.Union([
    Type.Literal("completed"),
    Type.Literal("applied"),
    Type.Literal("proposed"),
    Type.Literal("nothing"),
    Type.Literal("failed"),
  ]),
  proposalId: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  usage: Type.Optional(
    closedObject({
      inputTokens: Type.Number(),
      cachedInputTokens: Type.Number(),
      outputTokens: Type.Number(),
    }),
  ),
});

/** Reads persisted skill usage and collection review state. */
export const SkillsGardenerStatusParamsSchema = closedObject({});

export const SkillsGardenerStatusResultSchema = closedObject({
  lastAttemptAtMs: Type.Union([Type.Number(), Type.Null()]),
  lastSuccessAtMs: Type.Union([Type.Number(), Type.Null()]),
  lastError: Type.Union([Type.String(), Type.Null()]),
  collectionReview: Type.Optional(Type.Record(NonEmptyString, SkillCollectionReviewStatusSchema)),
  experienceReview: Type.Optional(Type.Record(NonEmptyString, SkillExperienceReviewStatusSchema)),
  counts: closedObject({
    active: Type.Number(),
    stale: Type.Number(),
    archived: Type.Number(),
  }),
  skills: Type.Array(SkillGardenerEntrySchema),
  overlaps: Type.Array(SkillOverlapCandidateSchema),
});

/** Preserves retired gardener action methods so clients receive an actionable error. */
export const SkillsGardenerActionParamsSchema = closedObject({ skill: NonEmptyString });

export const SkillsGardenerActionResultSchema = SkillGardenerEntrySchema;

export const SkillGardenerLiveEntrySchema = closedObject({
  ...SkillGardenerEntrySchema.properties,
  createdAtMs: Type.Union([Type.Number(), Type.Null()]),
  stateChangedAtMs: Type.Union([Type.Number(), Type.Null()]),
});

export const SkillsGardenerLiveStatusResultSchema = closedObject({
  ...SkillsGardenerStatusResultSchema.properties,
  inventory: Type.Literal("live-workshop"),
  skills: Type.Array(SkillGardenerLiveEntrySchema),
});

export type SkillsGardenerStatusParams = Static<typeof SkillsGardenerStatusParamsSchema>;
export type SkillsGardenerStatusResult = Static<typeof SkillsGardenerStatusResultSchema>;
export type SkillsGardenerLiveStatusResult = Static<typeof SkillsGardenerLiveStatusResultSchema>;
export type SkillsGardenerCompatibleStatusResult =
  | SkillsGardenerStatusResult
  | SkillsGardenerLiveStatusResult;
export type SkillsGardenerActionParams = Static<typeof SkillsGardenerActionParamsSchema>;
export type SkillsGardenerActionResult = Static<typeof SkillsGardenerActionResultSchema>;
