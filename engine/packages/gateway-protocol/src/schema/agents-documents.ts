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
/** Save a Library document's text, only while it still holds the text the editor opened (expectedHash). */
export const AgentsDocumentsSetParamsSchema = closedObject({
  agentId: NonEmptyString,
  name: NonEmptyString,
  content: Type.String(),
  expectedHash: Sha256String,
});
export const AgentsDocumentsSetResultSchema = closedObject({
  agentId: NonEmptyString,
  file: closedObject({
    name: NonEmptyString,
    path: NonEmptyString,
    size: Type.Integer({ minimum: 0 }),
    hash: Sha256String,
  }),
});
export type AgentsDocumentsCreateParams = Static<typeof AgentsDocumentsCreateParamsSchema>;
export type AgentsDocumentsSetParams = Static<typeof AgentsDocumentsSetParamsSchema>;
export type AgentsDocumentsSetResult = Static<typeof AgentsDocumentsSetResultSchema>;
export type AgentsDocumentsCreateResult = Static<typeof AgentsDocumentsCreateResultSchema>;
