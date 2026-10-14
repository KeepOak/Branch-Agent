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
  /** First-run answers by question id. A missing or empty answer takes the question's default. */
  answers: Type.Optional(
    Type.Record(Type.String({ maxLength: 32 }), Type.String({ maxLength: 500 })),
  ),
  /** The owner's IANA timezone for the template's routines. Defaults to this machine's timezone. */
  timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
});

/** Lists the template catalog: bundled templates and the ones imported on this computer. */
export const TrunkTemplateListParamsSchema = closedObject({});

/**
 * The starter teammates the main Trunk (the Chief) offers in its first conversation. An agentId that
 * is not the main Trunk gets an empty offer, so only the Chief offers.
 */
export const TrunkTemplateStartersParamsSchema = closedObject({
  agentId: Type.Optional(NonEmptyString),
  goal: Type.Optional(Type.String({ maxLength: 500 })),
});

/** Start (turn on) or stop (turn off) the routines of a Trunk made from a first-run template. */
export const TrunkTemplateFirstRunParamsSchema = closedObject({
  agentId: NonEmptyString,
});

/** The Overview cards for Trunks made from first-run templates. */
export const TrunkTemplateCardsParamsSchema = closedObject({});
