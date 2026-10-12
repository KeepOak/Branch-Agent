import { Type } from "typebox";
import { closedObject } from "./closed-object.js";
import { NonEmptyString } from "./primitives.js";

/** Exports one Trunk as a secret-free template (branch.trunk-template.json shape). */
export const TrunkTemplateExportParamsSchema = closedObject({
  agentId: NonEmptyString,
});

/** Creates a Trunk from a bundled template id, or from a template file on the gateway host. */
export const TrunkTemplateCreateParamsSchema = closedObject({
  templateId: Type.Optional(NonEmptyString),
  templatePath: Type.Optional(NonEmptyString),
  name: Type.Optional(NonEmptyString),
});
