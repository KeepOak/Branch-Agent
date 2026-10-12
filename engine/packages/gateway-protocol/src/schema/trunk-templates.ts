import { Type } from "typebox";
import { closedObject } from "./closed-object.js";
import { NonEmptyString } from "./primitives.js";

/** Exports one Trunk as a secret-free template (branch.trunk-template.json shape). */
export const TrunkTemplateExportParamsSchema = closedObject({
  agentId: NonEmptyString,
});

/**
 * Creates a Trunk from a catalog template id (bundled, or "imported:<slug>"), a template file on the
 * gateway host, a pasted template, or a template link. Pasted, linked and file templates are kept in
 * the imported catalog. Routines arrive turned off.
 */
export const TrunkTemplateCreateParamsSchema = closedObject({
  templateId: Type.Optional(NonEmptyString),
  templatePath: Type.Optional(NonEmptyString),
  template: Type.Optional(Type.Unknown()),
  link: Type.Optional(NonEmptyString),
  name: Type.Optional(NonEmptyString),
});

/** Lists the template catalog: bundled templates and the ones imported on this computer. */
export const TrunkTemplateListParamsSchema = closedObject({});
