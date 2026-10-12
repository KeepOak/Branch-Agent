// danny-avila/LibreChat@f10b1d91f1eee3a2c82d5247bf620351486b7c1b:packages/api/src/protection/types.ts (atlas SAFETY-0062)
import type { ToolArgumentFilterField } from "./filters.js";

/** Branch inspects the tool-argument source; upstream's other sources are not wired here. */
export type ContentSource = "tool_argument";

export type ContentProvenance =
  | "user"
  | "administrator"
  | "model"
  | "tool"
  | "retrieval"
  | "system"
  | "external_agent";

export type ContentFormat = "plain" | "markdown" | "json" | "uri";
export type ContentTreatment = "replaceable" | "inspect_only";
export type JsonPointer = `/${string}`;

export interface ContentFieldMap {
  tool_argument: ToolArgumentFilterField;
}

interface TextContentFragmentBase {
  readonly id: string;
  readonly provenance: ContentProvenance;
  readonly path: JsonPointer;
  readonly format: ContentFormat;
  readonly treatment: ContentTreatment;
  readonly text: string;
}

export type TextContentFragment = {
  [Source in ContentSource]: TextContentFragmentBase & {
    readonly source: Source;
    readonly field: ContentFieldMap[Source];
  };
}[ContentSource];

export interface ProtectionFinding {
  readonly detectorId: string;
  readonly ruleId: string;
  readonly label: string;
  readonly source: ContentSource;
  readonly field: ContentFieldMap[ContentSource];
  readonly provenance: ContentProvenance;
  readonly fragmentId: string;
  readonly fragmentPath: JsonPointer;
}
