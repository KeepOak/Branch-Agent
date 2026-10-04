import type { Static } from "typebox";
import { Type } from "typebox";
import { lazyCompile } from "../protocol-validator.js";
import { closedObject } from "./closed-object.js";
import { NonEmptyString } from "./primitives.js";

const binding = {
  sessionKey: NonEmptyString,
  expectedSessionId: NonEmptyString,
  lifecycleGeneration: NonEmptyString,
  // SHA256 of the verified immutable engine archive, never a mutable label.
  targetBuild: Type.String({ minLength: 64, maxLength: 64, pattern: "^[a-f0-9]{64}$" }),
};
export const DesktopRestartReceiptSchema = closedObject({ id: NonEmptyString, ...binding });
export const DesktopRestartCheckpointParamsSchema = closedObject({
  ...binding,
  checkpoint: NonEmptyString,
  message: NonEmptyString,
});
export const DesktopRestartAttemptSchema = closedObject({
  lifecycleGeneration: NonEmptyString,
  targetBuild: binding.targetBuild,
});
export const DesktopRestartPrepareParamsSchema = Type.Union([
  DesktopRestartCheckpointParamsSchema,
  DesktopRestartAttemptSchema,
]);
export const DesktopRestartPrepareResultSchema = Type.Union([
  DesktopRestartReceiptSchema,
  closedObject({
    status: Type.Union([Type.Literal("idle"), Type.Literal("deferred")]),
    lifecycleGeneration: NonEmptyString,
    targetBuild: binding.targetBuild,
  }),
]);
export const DesktopRestartResumeParamsSchema = DesktopRestartReceiptSchema;
export const DesktopRestartCancelParamsSchema = Type.Union([
  DesktopRestartReceiptSchema,
  DesktopRestartAttemptSchema,
]);
export const DesktopRestartObserveParamsSchema = DesktopRestartReceiptSchema;
export const DesktopRestartObserveResultSchema = closedObject({
  status: Type.Union([
    Type.Literal("waiting"),
    Type.Literal("recovered"),
    Type.Literal("completed"),
    Type.Literal("cancelled"),
    Type.Literal("session-changed"),
  ]),
  runId: Type.Optional(NonEmptyString),
  outcome: Type.Optional(
    Type.Union([
      Type.Literal("done"),
      Type.Literal("failed"),
      Type.Literal("killed"),
      Type.Literal("timeout"),
      Type.Literal("interrupted"),
    ]),
  ),
});
export const DesktopRestartIdentityParamsSchema = closedObject({});
export const DesktopRestartIdentityResultSchema = closedObject({
  targetBuild: binding.targetBuild,
  processInstanceId: NonEmptyString,
  pid: Type.Integer({ minimum: 1 }),
});
export const validateDesktopRestartIdentityParams = lazyCompile(DesktopRestartIdentityParamsSchema);
export const DesktopRestartResultSchema = closedObject({
  status: Type.Union([
    Type.Literal("accepted"),
    Type.Literal("session-changed"),
    Type.Literal("cancelled"),
    Type.Literal("uncertain"),
  ]),
  runId: Type.Optional(NonEmptyString),
});
export type DesktopRestartReceipt = Static<typeof DesktopRestartReceiptSchema>;
export type DesktopRestartCheckpointParams = Static<typeof DesktopRestartCheckpointParamsSchema>;
export type DesktopRestartPrepareParams = Static<typeof DesktopRestartPrepareParamsSchema>;
export const validateDesktopRestartPrepareParams = lazyCompile(DesktopRestartPrepareParamsSchema);
export const validateDesktopRestartCancelParams = lazyCompile(DesktopRestartCancelParamsSchema);
export const validateDesktopRestartReceipt = lazyCompile(DesktopRestartReceiptSchema);
export const DesktopRestartProtocolSchemas = {
  DesktopRestartObserveParams: DesktopRestartObserveParamsSchema,
  DesktopRestartObserveResult: DesktopRestartObserveResultSchema,
  DesktopRestartIdentityParams: DesktopRestartIdentityParamsSchema,
  DesktopRestartIdentityResult: DesktopRestartIdentityResultSchema,
  DesktopRestartReceipt: DesktopRestartReceiptSchema,
  DesktopRestartCheckpointParams: DesktopRestartCheckpointParamsSchema,
  DesktopRestartPrepareParams: DesktopRestartPrepareParamsSchema,
  DesktopRestartPrepareResult: DesktopRestartPrepareResultSchema,
  DesktopRestartResumeParams: DesktopRestartResumeParamsSchema,
  DesktopRestartCancelParams: DesktopRestartCancelParamsSchema,
  DesktopRestartResult: DesktopRestartResultSchema,
};
