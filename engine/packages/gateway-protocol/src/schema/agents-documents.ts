import type { Static } from "typebox";
import { Type } from "typebox";
import { closedObject } from "./closed-object.js";
import { NonEmptyString, Sha256String } from "./primitives.js";

/** Create a Library document without overwriting an existing document. */
export const AgentsDocumentsCreateParamsSchema = closedObject({
  agentId: NonEmptyString,
  name: NonEmptyString,
  content: Type.String(),
});
export const AgentsDocumentsCreateResultSchema = closedObject({
  agentId: NonEmptyString,
  file: closedObject({
    name: NonEmptyString,
    path: NonEmptyString,
    size: Type.Integer({ minimum: 0 }),
    hash: Sha256String,
  }),
});
export type AgentsDocumentsCreateParams = Static<typeof AgentsDocumentsCreateParamsSchema>;
export type AgentsDocumentsCreateResult = Static<typeof AgentsDocumentsCreateResultSchema>;
